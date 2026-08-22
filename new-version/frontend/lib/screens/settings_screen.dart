import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../core/auth_state.dart';
import '../models/person.dart';
import '../widgets/person_picker.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.api, required this.auth});
  final ApiClient api;
  final AuthState auth;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  List<Map<String, dynamic>>? _families;
  List<Person> _allPeople = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.api.get('/getMyFamiliesRoots'),
        widget.api.get('/people'),
      ]);
      final families = (results[0] as List).cast<Map<String, dynamic>>();
      final people = (results[1] as List)
          .cast<Map<String, dynamic>>()
          .map(Person.fromJson)
          .toList();
      setState(() {
        _families = families;
        _allPeople = people;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _setFamilyRoots(String familyId) async {
    final father = await showPersonPicker(
      context,
      people: _allPeople,
      title: 'Select father / eldest male ancestor',
    );
    if (father == null || !mounted) return;

    final mother = await showPersonPicker(
      context,
      people: _allPeople,
      title: 'Select mother / eldest female ancestor',
      excludeIds: {father.id},
    );
    if (!mounted) return;

    try {
      await widget.api.post('/roots/${Uri.encodeComponent(familyId)}', {
        'father_id': father.id,
        'mother_id': mother?.id,
      });
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _createFamily() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New family'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Family name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      await widget.api.post('/family/${Uri.encodeComponent(name)}');
      await widget.auth.refresh();
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _managePermissions(String familyId) async {
    List<dynamic> perms;
    try {
      perms = await widget.api.get('/family-permissions/${Uri.encodeComponent(familyId)}') as List;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
      return;
    }
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (context) => _PermissionsDialog(
        api: widget.api,
        familyId: familyId,
        initialPermissions: perms.cast<Map<String, dynamic>>(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Center(child: Text(_error!));
    if (_families == null) return const Center(child: CircularProgressIndicator());

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createFamily,
        icon: const Icon(Icons.add),
        label: const Text('New family'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          ListTile(
            title: Text(widget.auth.displayName ?? ''),
            subtitle: Text(widget.auth.email ?? ''),
          ),
          const Divider(height: 32),
          Text('Your families', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_families!.isEmpty) const Text('No families yet — create one below.'),
          for (final f in _families!)
            Card(
              child: ListTile(
                title: Row(
                  children: [
                    Text(f['family_id']?.toString() ?? ''),
                    const SizedBox(width: 8),
                    _RoleBadge(role: widget.auth.familyPermissions[f['family_id']] as String?),
                  ],
                ),
                subtitle: Text('Root: ${f['ancestor1'] ?? '?'} & ${f['ancestor2'] ?? '?'}'),
                onTap: () => _setFamilyRoots(f['family_id'] as String),
                trailing: widget.auth.isOwner(f['family_id'] as String)
                    ? IconButton(
                        icon: const Icon(Icons.group),
                        tooltip: 'Manage sharing',
                        onPressed: () => _managePermissions(f['family_id'] as String),
                      )
                    : null,
              ),
            ),
        ],
      ),
    );
  }
}

class _PermissionsDialog extends StatefulWidget {
  const _PermissionsDialog({
    required this.api,
    required this.familyId,
    required this.initialPermissions,
  });
  final ApiClient api;
  final String familyId;
  final List<Map<String, dynamic>> initialPermissions;

  @override
  State<_PermissionsDialog> createState() => _PermissionsDialogState();
}

class _PermissionsDialogState extends State<_PermissionsDialog> {
  late final List<Map<String, dynamic>> _permissions;
  final _emailController = TextEditingController();
  String _role = 'editor';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _permissions = List.of(widget.initialPermissions);
  }

  Future<void> _grant() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.api.post('/family-permissions/${Uri.encodeComponent(widget.familyId)}', {
        'email': email,
        'role': _role,
      });
      setState(() {
        _permissions.removeWhere((p) => p['email'] == email);
        _permissions.add({'email': email, 'role': _role});
        _emailController.clear();
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(String email) async {
    try {
      await widget.api.delete(
        '/family-permissions/${Uri.encodeComponent(widget.familyId)}/${Uri.encodeComponent(email)}',
      );
      setState(() => _permissions.removeWhere((p) => p['email'] == email));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Sharing: ${widget.familyId}'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_permissions.isEmpty) const Text('No one else has access yet.'),
            for (final p in _permissions)
              ListTile(
                dense: true,
                title: Text(p['email']?.toString() ?? ''),
                subtitle: Text(p['role']?.toString() ?? ''),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _revoke(p['email'] as String),
                ),
              ),
            const Divider(),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _emailController,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                ),
                const SizedBox(width: 8),
                DropdownButton<String>(
                  value: _role,
                  items: const [
                    DropdownMenuItem(value: 'editor', child: Text('editor')),
                    DropdownMenuItem(value: 'viewer', child: Text('viewer')),
                  ],
                  onChanged: (v) => setState(() => _role = v ?? 'editor'),
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(onPressed: _busy ? null : _grant, child: const Text('Grant')),
            ),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    );
  }
}

class _RoleBadge extends StatelessWidget {
  const _RoleBadge({required this.role});
  final String? role;

  @override
  Widget build(BuildContext context) {
    if (role == null) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final label = switch (role) {
      'owner' => 'Owner',
      'editor' => 'Editor',
      'viewer' => 'Viewer',
      _ => role!,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: role == 'owner' ? scheme.primaryContainer : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          color: role == 'owner' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
