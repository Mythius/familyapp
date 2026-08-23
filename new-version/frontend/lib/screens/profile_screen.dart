import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_client.dart';
import '../core/auth_state.dart';
import '../models/person.dart';
import '../widgets/person_picker.dart';

/// Field keys are the snake_case names the backend's /people/:name route
/// expects in the request body (family.ts's PERSON_FIELD_MAP) — kept
/// snake_case here rather than translated, so the request body can be built
/// directly from the controller map. Relationship fields (father/mother/
/// spouse/children) are handled separately below via a person-picker rather
/// than free text.
const _scalarFields = [
  ('name', 'Name'),
  ('gender', 'Gender'),
  ('birthday', 'Birthday (YYYY-MM-DD)'),
  ('death_date', 'Death date (YYYY-MM-DD)'),
  ('maiden_name', 'Maiden name'),
  ('address', 'Address'),
  ('phone', 'Phone'),
  ('email', 'Email'),
  ('facebook', 'Facebook'),
  ('instagram', 'Instagram'),
  ('notes', 'Notes'),
];

List<String> _splitNames(dynamic value) => (value as String? ?? '')
    .split(',')
    .map((s) => s.trim())
    .where((s) => s.isNotEmpty)
    .toList();

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.api,
    required this.auth,
    required this.name,
  });
  final ApiClient api;
  final AuthState auth;
  final String name;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _person;
  List<Person> _allPeople = [];
  String? _error;
  bool _editing = false;
  bool _saving = false;
  final Map<String, TextEditingController> _controllers = {};

  String? _fatherName;
  String? _motherName;
  List<String> _spouseNames = [];
  List<String> _childrenNames = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ProfileScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.name != widget.name) {
      _editing = false;
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _person = null;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.api.get('/people/${Uri.encodeComponent(widget.name)}'),
        widget.api.get('/people'),
      ]);
      final person = (results[0] as Map).cast<String, dynamic>();
      final allPeople =
          (results[1] as List)
              .cast<Map<String, dynamic>>()
              .map(Person.fromJson)
              .toList()
            ..sort(
              (a, b) => (a.name ?? '').toLowerCase().compareTo(
                (b.name ?? '').toLowerCase(),
              ),
            );

      for (final controller in _controllers.values) {
        controller.dispose();
      }
      _controllers.clear();
      for (final (key, _) in _scalarFields) {
        _controllers[key] = TextEditingController(text: _valueFor(person, key));
      }

      setState(() {
        _person = person;
        _allPeople = allPeople;
        _fatherName = person['father_name'] as String?;
        _motherName = person['mother_name'] as String?;
        _spouseNames = _splitNames(person['spouse_names']);
        _childrenNames = _splitNames(person['children_names']);
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  String _valueFor(Map<String, dynamic> person, String key) {
    switch (key) {
      case 'birthday':
        return _formatDate(person['birthday']);
      case 'death_date':
        return _formatDate(person['deathDate']);
      case 'maiden_name':
        return (person['maidenName'] ?? '').toString();
      default:
        return (person[key] ?? '').toString();
    }
  }

  String _formatDate(dynamic value) {
    if (value == null) return '';
    final d = DateTime.tryParse(value.toString());
    return d == null ? '' : DateFormat('yyyy-MM-dd').format(d);
  }

  /// Nicer view-mode rendering of a yyyy-MM-dd controller value, e.g.
  /// "1952-02-29" -> "February 29, 1952". Falls back to the raw text if it
  /// doesn't parse (shouldn't happen, since it's the same value _formatDate
  /// produced), rather than silently swallowing a real value.
  String _displayDate(String key) {
    final raw = _controllers[key]!.text;
    if (raw.isEmpty) return '';
    final d = DateTime.tryParse(raw);
    return d == null ? raw : DateFormat('MMMM d, y').format(d);
  }

  String _displayAge() {
    final deathDate = _controllers['death_date']!.text;
    if (deathDate.isNotEmpty) return '';
    final birth = DateTime.tryParse(_controllers['birthday']!.text);
    if (birth == null) return '';
    final years = DateTime.now().difference(birth).inDays ~/ 365;
    return '$years years';
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        for (final (key, _) in _scalarFields) key: _controllers[key]!.text.trim(),
        'father_name': _fatherName ?? '',
        'mother_name': _motherName ?? '',
        'spouse_names': _spouseNames.join(','),
        'children_names': _childrenNames.join(','),
      };
      await widget.api.post('/people/${Uri.encodeComponent(widget.name)}', body);
      setState(() => _editing = false);
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _goToPerson(String name) => context.go('/person/${Uri.encodeComponent(name)}');

  Set<int> get _selfAndRelatedIds {
    final selfId = _person?['id'] as int?;
    final ids = <int>{?selfId};
    for (final name in [_fatherName, _motherName, ..._spouseNames, ..._childrenNames]) {
      if (name == null) continue;
      final match = _allPeople.where((p) => p.name == name).firstOrNull;
      if (match != null) ids.add(match.id);
    }
    return ids;
  }

  Future<void> _pickFather() async {
    final picked = await showPersonPicker(
      context,
      people: _allPeople,
      title: 'Select father',
      excludeIds: _selfAndRelatedIds,
    );
    if (picked != null) setState(() => _fatherName = picked.name);
  }

  Future<void> _pickMother() async {
    final picked = await showPersonPicker(
      context,
      people: _allPeople,
      title: 'Select mother',
      excludeIds: _selfAndRelatedIds,
    );
    if (picked != null) setState(() => _motherName = picked.name);
  }

  Future<void> _addSpouse() async {
    final picked = await showPersonPicker(
      context,
      people: _allPeople,
      title: 'Add spouse',
      excludeIds: _selfAndRelatedIds,
    );
    if (picked?.name != null) setState(() => _spouseNames.add(picked!.name!));
  }

  Future<void> _addChild() async {
    final picked = await showPersonPicker(
      context,
      people: _allPeople,
      title: 'Add child',
      excludeIds: _selfAndRelatedIds,
    );
    if (picked?.name != null) setState(() => _childrenNames.add(picked!.name!));
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Below this width the profile switches from a wrapping grid of field
  /// tiles to one full-width tile per line — a grid of 168px tiles just
  /// leaves an awkward half-empty row on a phone-width screen.
  static const double _narrowBreakpoint = 600;

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Center(child: Text(_error!));
    if (_person == null) return const Center(child: CircularProgressIndicator());

    final familyId = _person!['familyId'] as String;
    final canEdit = widget.auth.canEdit(familyId);
    final isNarrow = MediaQuery.sizeOf(context).width < _narrowBreakpoint;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      _person!['name']?.toString() ?? '',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  IconButton(
                    tooltip: 'View in tree',
                    icon: const Icon(Icons.account_tree_outlined),
                    onPressed: () => context.go(
                      '/tree?person=${Uri.encodeComponent(_person!['name']?.toString() ?? '')}',
                    ),
                  ),
                  if (canEdit)
                    _editing
                        ? Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              TextButton(
                                onPressed: _saving ? null : () => setState(() => _editing = false),
                                child: const Text('Cancel'),
                              ),
                              const SizedBox(width: 8),
                              FilledButton(
                                onPressed: _saving ? null : _save,
                                child: _saving
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(strokeWidth: 2),
                                      )
                                    : const Text('Save'),
                              ),
                            ],
                          )
                        : OutlinedButton.icon(
                            onPressed: () => setState(() => _editing = true),
                            icon: const Icon(Icons.edit),
                            label: const Text('Edit'),
                          ),
                ],
              ),
              Text('Family: $familyId', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 16),
              _editing ? _editForm() : _viewDetails(isNarrow),
              const Divider(height: 32),
              Text('Relationships', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              _tileGroup(
                isNarrow: isNarrow,
                tiles: [
                  _relationshipTile(
                    label: 'Father',
                    fullWidth: isNarrow,
                    content: _singleRelationshipContent(
                      value: _fatherName,
                      onChange: _editing ? _pickFather : null,
                      onClear: _editing && _fatherName != null
                          ? () => setState(() => _fatherName = null)
                          : null,
                    ),
                  ),
                  _relationshipTile(
                    label: 'Mother',
                    fullWidth: isNarrow,
                    content: _singleRelationshipContent(
                      value: _motherName,
                      onChange: _editing ? _pickMother : null,
                      onClear: _editing && _motherName != null
                          ? () => setState(() => _motherName = null)
                          : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              _relationshipTile(
                label: 'Spouse(s)',
                fullWidth: true,
                content: _listRelationshipContent(
                  values: _spouseNames,
                  onAdd: _editing ? _addSpouse : null,
                  onRemove: _editing ? (n) => setState(() => _spouseNames.remove(n)) : null,
                ),
              ),
              const SizedBox(height: 10),
              _relationshipTile(
                label: 'Children',
                fullWidth: true,
                content: _listRelationshipContent(
                  values: _childrenNames,
                  onAdd: _editing ? _addChild : null,
                  onRemove: _editing ? (n) => setState(() => _childrenNames.remove(n)) : null,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Read-only view: every field always shows as a tile (label + value, or a
  /// muted "—" placeholder) — nothing disappears just because it's unset.
  /// On a narrow (phone-width) screen the tiles stack one per line instead
  /// of wrapping into a grid.
  Widget _viewDetails(bool isNarrow) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _tileGroup(
          isNarrow: isNarrow,
          tiles: [
            _FieldTile(label: 'Gender', value: _controllers['gender']!.text, fullWidth: isNarrow),
            _FieldTile(label: 'Birthday', value: _displayDate('birthday'), fullWidth: isNarrow),
            _FieldTile(label: 'Age', value: _displayAge(), fullWidth: isNarrow),
            _FieldTile(label: 'Death date', value: _displayDate('death_date'), fullWidth: isNarrow),
            _FieldTile(label: 'Maiden name', value: _controllers['maiden_name']!.text, fullWidth: isNarrow),
            _FieldTile(
              label: 'Phone',
              value: _controllers['phone']!.text,
              fullWidth: isNarrow,
              icon: Icons.call_outlined,
              iconTooltip: 'Call',
              onIconTap: () => launchUrl(Uri.parse('tel:${_controllers['phone']!.text}')),
            ),
            _FieldTile(
              label: 'Email',
              value: _controllers['email']!.text,
              fullWidth: isNarrow,
              icon: Icons.email_outlined,
              iconTooltip: 'Send email',
              onIconTap: () => launchUrl(Uri.parse('mailto:${_controllers['email']!.text}')),
            ),
            _FieldTile(label: 'Facebook', value: _controllers['facebook']!.text, fullWidth: isNarrow),
            _FieldTile(label: 'Instagram', value: _controllers['instagram']!.text, fullWidth: isNarrow),
          ],
        ),
        const SizedBox(height: 10),
        _FieldTile(
          label: 'Address',
          value: _controllers['address']!.text,
          fullWidth: true,
          icon: Icons.map_outlined,
          iconTooltip: 'Open in Maps',
          onIconTap: () => launchUrl(
            Uri.parse('https://maps.google.com/?q=${Uri.encodeComponent(_controllers['address']!.text)}'),
          ),
        ),
        const SizedBox(height: 10),
        _FieldTile(label: 'Notes', value: _controllers['notes']!.text, fullWidth: true),
      ],
    );
  }

  /// Lays a set of tiles out as a wrapping grid on wide screens, or a single
  /// stacked column (one tile per line) on narrow ones.
  Widget _tileGroup({required bool isNarrow, required List<Widget> tiles}) {
    if (!isNarrow) {
      return Wrap(spacing: 10, runSpacing: 10, children: tiles);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final tile in tiles) ...[tile, const SizedBox(height: 10)],
      ],
    );
  }

  /// Edit mode stays a plain stacked form — easier to type into (especially
  /// on a phone keyboard) than a grid of narrow fields.
  Widget _editForm() {
    return Column(
      children: [
        for (final (key, label) in _scalarFields)
          if (key != 'name')
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: TextField(
                controller: _controllers[key],
                decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
              ),
            ),
      ],
    );
  }

  Widget _relationshipTile({required String label, required Widget content, bool fullWidth = false}) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: fullWidth ? double.infinity : null,
      constraints: fullWidth ? null : const BoxConstraints(minWidth: 168, maxWidth: 280),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          content,
        ],
      ),
    );
  }

  Widget _singleRelationshipContent({
    required String? value,
    VoidCallback? onChange,
    VoidCallback? onClear,
  }) {
    if (value == null) {
      return onChange == null
          ? Text(
              '—',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
                fontStyle: FontStyle.italic,
              ),
            )
          : OutlinedButton(onPressed: onChange, child: const Text('Set'));
    }
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 4,
      children: [
        _NameChip(name: value, onTap: () => _goToPerson(value)),
        if (onChange != null)
          IconButton(icon: const Icon(Icons.edit, size: 16), tooltip: 'Change', onPressed: onChange),
        if (onClear != null)
          IconButton(icon: const Icon(Icons.close, size: 16), tooltip: 'Clear', onPressed: onClear),
      ],
    );
  }

  Widget _listRelationshipContent({
    required List<String> values,
    VoidCallback? onAdd,
    void Function(String)? onRemove,
  }) {
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      runSpacing: 6,
      children: [
        if (values.isEmpty && onAdd == null)
          Text(
            '—',
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
              fontStyle: FontStyle.italic,
            ),
          ),
        for (final name in values)
          onRemove == null
              ? _NameChip(name: name, onTap: () => _goToPerson(name))
              : Chip(label: Text(name), onDeleted: () => onRemove(name)),
        if (onAdd != null)
          ActionChip(avatar: const Icon(Icons.add, size: 16), label: const Text('Add'), onPressed: onAdd),
      ],
    );
  }
}

/// A person's name, styled as a tappable chip rather than a plain
/// underlined link — used anywhere a relationship links to another
/// person's profile (Father/Mother/Spouse(s)/Children).
class _NameChip extends StatelessWidget {
  const _NameChip({required this.name, required this.onTap});
  final String name;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ActionChip(
      label: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 220),
        child: Text(name, overflow: TextOverflow.ellipsis, maxLines: 1),
      ),
      avatar: Icon(Icons.person_outline, size: 16, color: scheme.onPrimaryContainer),
      backgroundColor: scheme.primaryContainer,
      labelStyle: TextStyle(color: scheme.onPrimaryContainer),
      side: BorderSide.none,
      onPressed: onTap,
    );
  }
}

/// One always-visible field card: label caption + value, or an italic muted
/// "—" placeholder when unset — deliberately never hidden, so the profile
/// reads as a consistent grid rather than a sparse list of whatever happens
/// to be filled in.
class _FieldTile extends StatelessWidget {
  const _FieldTile({
    required this.label,
    required this.value,
    this.icon,
    this.iconTooltip,
    this.onIconTap,
    this.fullWidth = false,
  });

  final String label;
  final String value;
  final IconData? icon;
  final String? iconTooltip;
  final VoidCallback? onIconTap;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final hasValue = value.trim().isNotEmpty;
    return Container(
      width: fullWidth ? double.infinity : 168,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  hasValue ? value : '—',
                  style: TextStyle(
                    color: hasValue ? scheme.onSurface : scheme.onSurfaceVariant.withValues(alpha: 0.6),
                    fontStyle: hasValue ? FontStyle.normal : FontStyle.italic,
                  ),
                ),
              ),
              if (icon != null && hasValue)
                InkWell(
                  onTap: onIconTap,
                  borderRadius: BorderRadius.circular(4),
                  child: Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: Icon(icon, size: 16, color: scheme.primary),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
