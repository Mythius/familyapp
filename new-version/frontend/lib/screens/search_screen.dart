import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/api_client.dart';
import '../core/auth_state.dart';
import '../models/person.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, required this.api, required this.auth});
  final ApiClient api;
  final AuthState auth;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  List<Person>? _people;
  String _query = '';
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/people') as List;
      final people = data.cast<Map<String, dynamic>>().map(Person.fromJson).toList()
        ..sort((a, b) =>
            (a.name ?? '').toLowerCase().compareTo((b.name ?? '').toLowerCase()));
      setState(() {
        _people = people;
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _createPerson([String prefillName = '']) async {
    final editable = widget.auth.editableFamilyIds;
    if (editable.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("You don't have edit access to any family yet.")),
      );
      return;
    }
    final nameController = TextEditingController(text: prefillName);
    String familyId = editable.first;
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('New person'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Name'),
                autofocus: true,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: familyId,
                decoration: const InputDecoration(labelText: 'Family'),
                items: editable
                    .map((f) => DropdownMenuItem(value: f, child: Text(f)))
                    .toList(),
                onChanged: (v) => setDialogState(() => familyId = v ?? familyId),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Create')),
          ],
        ),
      ),
    );

    if (created != true || nameController.text.trim().isEmpty) return;
    try {
      await widget.api.post('/people', {
        'name': nameController.text.trim(),
        'family_id': familyId,
      });
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Center(child: Text(_error!));
    if (_people == null) return const Center(child: CircularProgressIndicator());

    final filtered = _query.isEmpty
        ? _people!
        : _people!
            .where((p) => (p.name ?? '').toLowerCase().contains(_query.toLowerCase()))
            .toList();

    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: _createPerson,
        tooltip: 'New person',
        child: const Icon(Icons.person_add),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search people…',
                border: OutlineInputBorder(),
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: filtered.isEmpty && _query.isNotEmpty
                  ? _EmptyResults(query: _query, onCreate: () => _createPerson(_query))
                  : ListView.separated(
                      itemCount: filtered.length,
                      separatorBuilder: (context, index) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final p = filtered[i];
                        return ListTile(
                          title: Text(p.name ?? '(no name)'),
                          subtitle: Text(p.familyId),
                          trailing: widget.auth.canEdit(p.familyId)
                              ? const Icon(Icons.edit, size: 16)
                              : null,
                          onTap: () => context.go('/person/${Uri.encodeComponent(p.name ?? '')}'),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyResults extends StatelessWidget {
  const _EmptyResults({required this.query, required this.onCreate});
  final String query;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('No one named "$query" yet.', style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onCreate,
            icon: const Icon(Icons.person_add),
            label: Text('Create "$query"'),
          ),
        ],
      ),
    );
  }
}
