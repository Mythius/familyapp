import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/person.dart';

enum ContactMode { text, email }

/// Lets the user narrow a browse-filtered list of people down to individual
/// recipients, then hands the selected phone numbers/emails off to the
/// device's default messaging/mail app as a single group conversation.
class ContactSelectScreen extends StatefulWidget {
  const ContactSelectScreen({super.key, required this.people, required this.mode});
  final List<Person> people;
  final ContactMode mode;

  @override
  State<ContactSelectScreen> createState() => _ContactSelectScreenState();
}

class _ContactSelectScreenState extends State<ContactSelectScreen> {
  late Set<int> _selectedIds;

  bool get _isText => widget.mode == ContactMode.text;

  String? _contactFor(Person p) => _isText ? p.phone : p.email;

  @override
  void initState() {
    super.initState();
    // Default to everyone who actually has the needed contact info selected —
    // the user already narrowed the list on Browse, so this is a refinement.
    _selectedIds = widget.people.where((p) => (_contactFor(p) ?? '').trim().isNotEmpty).map((p) => p.id).toSet();
  }

  void _toggle(int id, bool? value) {
    setState(() {
      if (value ?? false) {
        _selectedIds.add(id);
      } else {
        _selectedIds.remove(id);
      }
    });
  }

  Future<void> _next() async {
    final contacts = widget.people
        .where((p) => _selectedIds.contains(p.id))
        .map(_contactFor)
        .whereType<String>()
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();

    if (contacts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Select at least one person with a ${_isText ? 'phone number' : 'email address'}.')),
      );
      return;
    }

    final uri = Uri(scheme: _isText ? 'sms' : 'mailto', path: contacts.join(','));
    final launched = await launchUrl(uri);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open a ${_isText ? 'texting' : 'email'} app.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final withContact = widget.people.where((p) => (_contactFor(p) ?? '').trim().isNotEmpty).toList();
    final withoutContact = widget.people.length - withContact.length;

    return Scaffold(
      appBar: AppBar(title: Text(_isText ? 'Group text' : 'Group email')),
      body: Column(
        children: [
          if (withoutContact > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                '$withoutContact ${withoutContact == 1 ? 'person has' : 'people have'} no '
                '${_isText ? 'phone number' : 'email'} on file and can\'t be included.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ),
          Expanded(
            child: ListView.builder(
              itemCount: withContact.length,
              itemBuilder: (context, i) {
                final p = withContact[i];
                return CheckboxListTile(
                  value: _selectedIds.contains(p.id),
                  onChanged: (v) => _toggle(p.id, v),
                  title: Text(p.name ?? '(no name)'),
                  subtitle: Text(_contactFor(p) ?? ''),
                );
              },
            ),
          ),
          SafeArea(
            minimum: const EdgeInsets.all(16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _next,
                icon: Icon(_isText ? Icons.sms_outlined : Icons.email_outlined),
                label: Text('Next (${_selectedIds.length} selected)'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
