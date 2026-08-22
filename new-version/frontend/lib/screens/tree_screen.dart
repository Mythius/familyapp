import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../core/auth_state.dart';
import '../models/person.dart';
import '../tree/tree_layout.dart';
import '../tree/tree_node_widget.dart';
import '../tree/tree_painter.dart';

/// Top padding above the first generation row, in the same coordinate space
/// as [kGenLabelWidth] — leaves room so the topmost node isn't flush against
/// the canvas edge.
const double _kTopPadding = 24;

class TreeScreen extends StatefulWidget {
  const TreeScreen({super.key, required this.api, required this.auth});
  final ApiClient api;
  final AuthState auth;

  @override
  State<TreeScreen> createState() => _TreeScreenState();
}

class _TreeScreenState extends State<TreeScreen> {
  List<Person> _allPeople = [];
  Map<int, Person> _peopleById = {};
  Person? _selected;
  Map<int, NodePosition>? _positions;
  List<int> _genNumbers = [];
  bool _loadingPeople = true;
  bool _loadingTree = false;
  String? _error;
  String _query = '';
  final TransformationController _viewController = TransformationController();

  @override
  void initState() {
    super.initState();
    _loadPeople();
  }

  @override
  void dispose() {
    _viewController.dispose();
    super.dispose();
  }

  Future<void> _loadPeople() async {
    try {
      final data = await widget.api.get('/people') as List;
      final people = data.cast<Map<String, dynamic>>().map(Person.fromJson).toList()
        ..sort((a, b) =>
            (a.name ?? '').toLowerCase().compareTo((b.name ?? '').toLowerCase()));
      setState(() {
        _allPeople = people;
        _peopleById = {for (final p in people) p.id: p};
        _loadingPeople = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loadingPeople = false;
      });
    }
  }

  Future<void> _selectPerson(Person p) async {
    setState(() {
      _selected = p;
      _positions = null;
      _loadingTree = true;
    });
    try {
      final data = await widget.api.get('/descendants/${p.id}') as Map;
      final generations = data.cast<String, dynamic>();

      final nodes = <TreeNode>[];
      generations.forEach((idStr, gen) {
        final person = _peopleById[int.parse(idStr)];
        if (person != null) nodes.add(TreeNode(person: person, generation: gen as String));
      });

      final raw = buildTreeLayout(nodes);
      // Shift into render space: leave room for the "Gen N" labels on the
      // left and a little breathing room above the top row.
      final shifted = <int, NodePosition>{
        for (final entry in raw.entries)
          entry.key: NodePosition(
            entry.value.x + kGenLabelWidth,
            entry.value.y + _kTopPadding,
            entry.value.node,
          ),
      };
      final genNumbers = nodes.map((n) => n.genNumber).toSet().toList()..sort();

      _viewController.value = Matrix4.identity();
      setState(() {
        _positions = shifted;
        _genNumbers = genNumbers;
        _loadingTree = false;
      });
    } catch (e) {
      setState(() => _loadingTree = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingPeople) return const Center(child: CircularProgressIndicator());
    if (_error != null) return Center(child: Text(_error!));

    final filtered = _query.isEmpty
        ? _allPeople
        : _allPeople
            .where((p) => (p.name ?? '').toLowerCase().contains(_query.toLowerCase()))
            .toList();

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 280,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(8),
                child: TextField(
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Find a starting person…',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _query = v),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: filtered.length,
                  itemBuilder: (context, i) {
                    final p = filtered[i];
                    return ListTile(
                      selected: _selected?.id == p.id,
                      title: Text(p.name ?? '(no name)'),
                      subtitle: Text(p.familyId, style: Theme.of(context).textTheme.bodySmall),
                      onTap: () => _selectPerson(p),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        const VerticalDivider(width: 1),
        Expanded(child: _buildCanvas()),
      ],
    );
  }

  Widget _buildCanvas() {
    if (_selected == null) {
      return const Center(child: Text('Pick a starting person to see their family tree.'));
    }
    if (_loadingTree || _positions == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_positions!.isEmpty) {
      return const Center(child: Text('No tree data for this person.'));
    }

    var maxX = 0.0, maxY = 0.0;
    for (final pos in _positions!.values) {
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }
    final contentWidth = maxX + kNodeWidth + 40;
    final contentHeight = maxY + kNodeHeight + 40;

    return ColoredBox(
      color: const Color(0xFFF8F9FA),
      child: Stack(
        children: [
          InteractiveViewer(
            transformationController: _viewController,
            constrained: false,
            minScale: 0.1,
            maxScale: 3,
            trackpadScrollCausesScale: true,
            boundaryMargin: const EdgeInsets.all(400),
            child: SizedBox(
              width: contentWidth,
              height: contentHeight,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: CustomPaint(
                      painter: TreeConnectorPainter(_positions!, _genNumbers),
                    ),
                  ),
                  for (final pos in _positions!.values)
                    Positioned(
                      left: pos.x,
                      top: pos.y,
                      child: TreeNodeWidget(
                        node: pos.node,
                        onTap: () => _selectPerson(pos.node.person),
                      ),
                    ),
                ],
              ),
            ),
          ),
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton.small(
              tooltip: 'Reset view',
              onPressed: () => _viewController.value = Matrix4.identity(),
              child: const Icon(Icons.center_focus_strong),
            ),
          ),
        ],
      ),
    );
  }
}
