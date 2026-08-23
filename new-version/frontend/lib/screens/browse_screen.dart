import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../browse/tree_order.dart';
import '../core/api_client.dart';
import '../core/csv_export/csv_export.dart';
import '../models/person.dart';
import '../widgets/person_picker.dart';
import 'contact_select_screen.dart';

class BrowseScreen extends StatefulWidget {
  const BrowseScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<BrowseScreen> createState() => _BrowseScreenState();
}

// family_id is deliberately not a display column here — matches the
// prototype's buildFilteredTableData(), which drops it as "an old internal
// artifact." It's still available as a filter (see _familyFilter) since that's
// a genuinely useful way to narrow a multi-family account, just not a column
// worth showing once you already know which family you filtered to.
const _columns = [
  'name',
  'generation',
  'gender',
  'birthday',
  'deathDate',
  'maidenName',
  'address',
  'phone',
  'email',
  'marriageDate',
  'fatherName',
  'motherName',
  'spouseNames',
  'treeOrder',
];

class _BrowseScreenState extends State<BrowseScreen> {
  List<Person>? _people;
  String? _error;

  String? _familyFilter;
  String? _genderFilter;
  String? _statusFilter; // 'alive' | 'deceased' | null
  String? _hasBirthdayFilter; // 'yes' | 'no' | null
  String? _generationFilter;
  final _ageMinController = TextEditingController();
  final _ageMaxController = TextEditingController();

  Person? _descendantOf;
  Map<String, dynamic>? _descendantGenerations;

  bool _filtersExpanded = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _ageMinController.dispose();
    _ageMaxController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/people') as List;
      setState(() => _people = data.cast<Map<String, dynamic>>().map(Person.fromJson).toList());
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  int _ageOf(DateTime birthday) => DateTime.now().difference(birthday).inDays ~/ 365;

  Future<void> _pickDescendantOf() async {
    final picked = await showPersonPicker(context, people: _people!, title: 'Show descendants of…');
    if (picked == null) return;
    try {
      final data = await widget.api.get('/descendants/${picked.id}') as Map;
      setState(() {
        _descendantOf = picked;
        _descendantGenerations = data.cast<String, dynamic>();
        // The set of valid generation labels changes shape (own stored
        // generation vs. tree-relative "2.1"-style labels) whenever the
        // descendant root changes, so a filter picked under the old scheme
        // may no longer be a valid dropdown item.
        _generationFilter = null;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  void _clearDescendantOf() => setState(() {
        _descendantOf = null;
        _descendantGenerations = null;
        _generationFilter = null;
      });

  void _clearFilters() {
    setState(() {
      _familyFilter = null;
      _genderFilter = null;
      _statusFilter = null;
      _hasBirthdayFilter = null;
      _generationFilter = null;
      _ageMinController.clear();
      _ageMaxController.clear();
    });
    _clearDescendantOf();
  }

  /// The generation label to filter/display for a person — the descendant
  /// tree's per-render generation ("2.1" for a spouse) when a "descendants
  /// of" root is set, otherwise the person's own stored generation.
  String? _generationOf(Person p) =>
      _descendantGenerations != null ? _descendantGenerations![p.id.toString()]?.toString() : p.generation;

  List<Person> get _filtered {
    final descendantIds = _descendantGenerations?.keys.map(int.parse).toSet();
    final ageMin = int.tryParse(_ageMinController.text);
    final ageMax = int.tryParse(_ageMaxController.text);

    return _people!.where((p) {
      if (_familyFilter != null && p.familyId != _familyFilter) return false;
      if (descendantIds != null && !descendantIds.contains(p.id)) return false;
      if (_genderFilter != null && p.gender != _genderFilter) return false;
      if (_statusFilter == 'alive' && p.deathDate != null) return false;
      if (_statusFilter == 'deceased' && p.deathDate == null) return false;
      if (_hasBirthdayFilter == 'yes' && p.birthday == null) return false;
      if (_hasBirthdayFilter == 'no' && p.birthday != null) return false;
      if (_generationFilter != null && _generationOf(p) != _generationFilter) return false;
      if (ageMin != null || ageMax != null) {
        if (p.birthday == null) return false;
        final age = _ageOf(p.birthday!);
        if (ageMin != null && age < ageMin) return false;
        if (ageMax != null && age > ageMax) return false;
      }
      return true;
    }).toList();
  }

  String _cell(Person p, String col, Map<int, String?> namesById, Map<int, int> treeOrder) {
    switch (col) {
      case 'name':
        return p.name ?? '';
      case 'generation':
        return (_descendantGenerations?[p.id.toString()] ?? p.generation ?? '').toString();
      case 'gender':
        return p.gender ?? '';
      case 'birthday':
        return p.birthday == null ? '' : DateFormat('yyyy-MM-dd').format(p.birthday!);
      case 'deathDate':
        return p.deathDate == null ? '' : DateFormat('yyyy-MM-dd').format(p.deathDate!);
      case 'maidenName':
        return p.maidenName ?? '';
      case 'address':
        return p.address ?? '';
      case 'phone':
        return p.phone ?? '';
      case 'email':
        return p.email ?? '';
      case 'marriageDate':
        return p.marriageDate == null ? '' : DateFormat('yyyy-MM-dd').format(p.marriageDate!);
      case 'fatherName':
        return p.fatherId == null ? '' : (namesById[p.fatherId] ?? '');
      case 'motherName':
        return p.motherId == null ? '' : (namesById[p.motherId] ?? '');
      case 'spouseNames':
        return p.spouseId == null ? '' : (namesById[p.spouseId] ?? '');
      case 'treeOrder':
        return (treeOrder[p.id] ?? '').toString();
      default:
        return '';
    }
  }

  void _export(List<Person> rows, Map<int, String?> namesById, Map<int, int> treeOrder) {
    final buffer = StringBuffer()..writeln(_columns.join(','));
    for (final p in rows) {
      buffer.writeln(_columns
          .map((c) => '"${_cell(p, c, namesById, treeOrder).replaceAll('"', '""')}"')
          .join(','));
    }
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    downloadCsv('family_export_$today.csv', buffer.toString());
  }

  List<String> _generationOptions() {
    final values = _people!.map(_generationOf).whereType<String>().toSet().toList();
    values.sort((a, b) {
      final na = double.tryParse(a);
      final nb = double.tryParse(b);
      if (na != null && nb != null) return na.compareTo(nb);
      return a.compareTo(b);
    });
    return values;
  }

  void _openContactSelect(List<Person> rows, ContactMode mode) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ContactSelectScreen(people: rows, mode: mode)),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Center(child: Text(_error!));
    if (_people == null) return const Center(child: CircularProgressIndicator());

    final familyIds = _people!.map((p) => p.familyId).toSet().toList()..sort();
    final namesById = {for (final p in _people!) p.id: p.name};
    final treeOrder = computeTreeOrder(_people!, rootId: _descendantOf?.id);
    final generationOptions = _generationOptions();

    final rows = _filtered
      ..sort((a, b) => (treeOrder[a.id] ?? 1 << 30).compareTo(treeOrder[b.id] ?? 1 << 30));

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Row(
            children: [
              IconButton(
                tooltip: _filtersExpanded ? 'Hide filters' : 'Show filters',
                icon: Icon(_filtersExpanded ? Icons.expand_less : Icons.expand_more),
                onPressed: () => setState(() => _filtersExpanded = !_filtersExpanded),
              ),
              Text('Filters', style: Theme.of(context).textTheme.titleSmall),
              const Spacer(),
              Text('${rows.length} people', style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
        if (_filtersExpanded)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _dropdown<String>('Family', _familyFilter, familyIds,
                        (v) => setState(() => _familyFilter = v), (v) => v ?? 'All'),
                    _dropdown<String>('Gender', _genderFilter, const ['Male', 'Female'],
                        (v) => setState(() => _genderFilter = v), (v) => v ?? 'All'),
                    _dropdown<String>('Status', _statusFilter, const ['alive', 'deceased'],
                        (v) => setState(() => _statusFilter = v),
                        (v) => v == null ? 'All' : (v == 'alive' ? 'Alive' : 'Deceased')),
                    _dropdown<String>('Has birthday', _hasBirthdayFilter, const ['yes', 'no'],
                        (v) => setState(() => _hasBirthdayFilter = v),
                        (v) => v == null ? 'All' : (v == 'yes' ? 'Yes' : 'No')),
                    _dropdown<String>('Generation', _generationFilter, generationOptions,
                        (v) => setState(() => _generationFilter = v), (v) => v ?? 'All'),
                    SizedBox(
                      width: 90,
                      child: TextField(
                        controller: _ageMinController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Age min', isDense: true),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    SizedBox(
                      width: 90,
                      child: TextField(
                        controller: _ageMaxController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Age max', isDense: true),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    _descendantOf == null
                        ? OutlinedButton.icon(
                            onPressed: _pickDescendantOf,
                            icon: const Icon(Icons.account_tree_outlined, size: 16),
                            label: const Text('Descendants of…'),
                          )
                        : Chip(
                            label: Text('Descendants of ${_descendantOf!.name}'),
                            onDeleted: _clearDescendantOf,
                          ),
                    TextButton(onPressed: _clearFilters, child: const Text('Clear filters')),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    OutlinedButton.icon(
                      onPressed: rows.isEmpty ? null : () => _openContactSelect(rows, ContactMode.text),
                      icon: const Icon(Icons.sms_outlined, size: 16),
                      label: const Text('Text selected…'),
                    ),
                    OutlinedButton.icon(
                      onPressed: rows.isEmpty ? null : () => _openContactSelect(rows, ContactMode.email),
                      icon: const Icon(Icons.email_outlined, size: 16),
                      label: const Text('Email selected…'),
                    ),
                    if (kIsWeb)
                      FilledButton.icon(
                        onPressed: () => _export(rows, namesById, treeOrder),
                        icon: const Icon(Icons.download),
                        label: const Text('Export CSV'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        const Divider(height: 1),
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SingleChildScrollView(
              child: DataTable(
                columns: _columns.map((c) => DataColumn(label: Text(c))).toList(),
                rows: rows
                    .map((p) => DataRow(
                          cells: _columns
                              .map((c) => DataCell(Text(_cell(p, c, namesById, treeOrder))))
                              .toList(),
                        ))
                    .toList(),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // DropdownButtonFormField<T> must be instantiated with a non-nullable T —
  // giving it T = String? directly (rather than letting the framework's own
  // T? wrapping handle "no selection") causes a runtime type-cast crash deep
  // in Flutter's internals when the dropdown opens. So T here is always the
  // non-nullable option type, "All" is a real null entry the framework
  // manages itself, and [options] never includes null.
  Widget _dropdown<T extends Object>(
    String label,
    T? value,
    List<T> options,
    void Function(T?) onChanged,
    String Function(T?) labelFor,
  ) {
    return SizedBox(
      width: 160,
      child: DropdownButtonFormField<T>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label, isDense: true),
        items: [
          DropdownMenuItem<T>(
            value: null,
            child: Text(labelFor(null), overflow: TextOverflow.ellipsis),
          ),
          ...options.map((o) => DropdownMenuItem<T>(
                value: o,
                child: Text(labelFor(o), overflow: TextOverflow.ellipsis),
              )),
        ],
        onChanged: onChanged,
      ),
    );
  }
}
