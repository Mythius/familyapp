import 'package:flutter/material.dart';
import '../models/person.dart';

/// Live-search person picker, matching the prototype's `personSelectModal` —
/// used anywhere a relationship needs picking a real, existing person rather
/// than free-typing a name (family roots, profile relationship fields).
/// Resolves to `null` if the user cancels.
Future<Person?> showPersonPicker(
  BuildContext context, {
  required List<Person> people,
  String title = 'Select a person',
  Set<int>? excludeIds,
}) {
  return showDialog<Person>(
    context: context,
    builder: (context) => _PersonPickerDialog(
      people: people,
      title: title,
      excludeIds: excludeIds,
    ),
  );
}

class _PersonPickerDialog extends StatefulWidget {
  const _PersonPickerDialog({required this.people, required this.title, this.excludeIds});
  final List<Person> people;
  final String title;
  final Set<int>? excludeIds;

  @override
  State<_PersonPickerDialog> createState() => _PersonPickerDialogState();
}

class _PersonPickerDialogState extends State<_PersonPickerDialog> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.people.where((p) {
      if (widget.excludeIds?.contains(p.id) ?? false) return false;
      if (_query.isEmpty) return true;
      return (p.name ?? '').toLowerCase().contains(_query.toLowerCase());
    }).toList()
      ..sort((a, b) => (a.name ?? '').toLowerCase().compareTo((b.name ?? '').toLowerCase()));

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420, maxHeight: 520),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(widget.title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              TextField(
                autofocus: true,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search by name…',
                  border: OutlineInputBorder(),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: filtered.isEmpty
                    ? const Center(child: Text('No matches'))
                    : ListView.builder(
                        itemCount: filtered.length,
                        itemBuilder: (context, i) {
                          final p = filtered[i];
                          return ListTile(
                            title: Text(p.name ?? '(no name)'),
                            onTap: () => Navigator.pop(context, p),
                          );
                        },
                      ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancel'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
