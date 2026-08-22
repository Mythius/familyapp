import '../models/person.dart';

// Layout constants — match the prototype's tree.js so the diagram reads the
// same way (node size, spacing, generation row height).
const double kNodeWidth = 140;
const double kNodeHeight = 50;
const double kHorizontalSpacing = 20;
const double kVerticalSpacing = 100;
const double kSpouseGap = 10;
const double kGenLabelWidth = 60;

/// One person placed in a specific generation of the tree currently being
/// rendered. [generation] comes from GET /descendants/:id (e.g. "2", "2.1"
/// for a spouse) — a different, per-render concept from Person's own
/// `generation` field, which the prototype's tree.js also ignores in favor
/// of the descendants-endpoint value.
class TreeNode {
  TreeNode({required this.person, required this.generation});
  final Person person;
  final String generation;

  int get genNumber => double.parse(generation).floor();
  bool get isSpouseSlot => generation.contains('.');
}

class NodePosition {
  NodePosition(this.x, this.y, this.node);
  double x;
  double y;
  final TreeNode node;
}

class _Unit {
  _Unit(this.members)
      : width = members.length * kNodeWidth + (members.length - 1) * kSpouseGap;
  final List<TreeNode> members;
  final double width;
}

class _UnitPos {
  _UnitPos(this.unit, this.idealX);
  final _Unit unit;
  double? idealX;
}

class _PlacedUnit {
  _PlacedUnit(this.x, this.width);
  final double x;
  final double width;
}

/// Two-pass layout, ported from the prototype's tree.js `buildLayout()`:
/// pass 1 sorts every generation top-down (by parent order) to fix a stable
/// left-to-right ordering; pass 2 positions bottom-up (deepest generation
/// first, centering parents over already-placed children) using that order.
/// A third pass tucks childless spouses next to their partner.
Map<int, NodePosition> buildTreeLayout(List<TreeNode> people) {
  final positions = <int, NodePosition>{};
  if (people.isEmpty) return positions;

  final peopleMap = {for (final p in people) p.person.id: p};

  final genGroups = <int, List<TreeNode>>{};
  for (final p in people) {
    genGroups.putIfAbsent(p.genNumber, () => []).add(p);
  }
  final sortedGens = genGroups.keys.toList()..sort();
  final minGen = sortedGens.first;
  final maxGen = sortedGens.last;

  List<TreeNode> getSpouses(TreeNode person) {
    final spouses = <TreeNode>[];
    final personGen = person.genNumber;

    final spouseId = person.person.spouseId;
    if (spouseId != null && peopleMap.containsKey(spouseId)) {
      final spouse = peopleMap[spouseId]!;
      if (spouse.genNumber == personGen) spouses.add(spouse);
    }
    for (final p in people) {
      if (p.person.id == person.person.id) continue;
      if (p.genNumber != personGen) continue;
      if (p.person.spouseId == person.person.id &&
          !spouses.any((s) => s.person.id == p.person.id)) {
        spouses.add(p);
      }
    }
    return spouses;
  }

  List<_Unit> createUnits(List<TreeNode> orderedBloodDescendants) {
    final placed = <int>{};
    final units = <_Unit>[];
    for (final person in orderedBloodDescendants) {
      if (placed.contains(person.person.id)) continue;
      if (person.isSpouseSlot) continue;
      placed.add(person.person.id);

      final spouses = getSpouses(person).where((s) => !placed.contains(s.person.id)).toList();
      if (spouses.isNotEmpty) {
        for (final s in spouses) {
          placed.add(s.person.id);
        }
        units.add(_Unit([person, ...spouses]));
      } else {
        units.add(_Unit([person]));
      }
    }
    return units;
  }

  double unitFullWidth(_Unit unit) => unit.width + kHorizontalSpacing;

  // PASS 1: top-down sort to establish a canonical left-to-right order.
  final orderedByGen = <int, List<TreeNode>>{};
  for (final gen in sortedGens) {
    final peopleInGen = genGroups[gen] ?? [];
    final bloodDescendants = peopleInGen.where((p) => !p.isSpouseSlot).toList();

    if (gen == minGen) {
      bloodDescendants.sort((a, b) => a.person.id.compareTo(b.person.id));
      orderedByGen[gen] = bloodDescendants;
      continue;
    }

    final parentOrder = orderedByGen[gen - 1] ?? [];
    final parentIndexMap = <int, int>{};
    for (var i = 0; i < parentOrder.length; i++) {
      parentIndexMap[parentOrder[i].person.id] = i;
    }
    for (final p in parentOrder) {
      for (final spouse in getSpouses(p)) {
        parentIndexMap.putIfAbsent(spouse.person.id, () => parentIndexMap[p.person.id]!);
      }
    }

    const noParent = 1 << 30;
    int parentIdxOf(TreeNode n) {
      final fatherId = n.person.fatherId;
      final motherId = n.person.motherId;
      final fatherIdx = (fatherId != null && parentIndexMap.containsKey(fatherId))
          ? parentIndexMap[fatherId]!
          : noParent;
      final motherIdx = (motherId != null && parentIndexMap.containsKey(motherId))
          ? parentIndexMap[motherId]!
          : noParent;
      return fatherIdx < motherIdx ? fatherIdx : motherIdx;
    }

    bloodDescendants.sort((a, b) {
      final aIdx = parentIdxOf(a);
      final bIdx = parentIdxOf(b);
      if (aIdx != bIdx) return aIdx.compareTo(bIdx);
      return a.person.id.compareTo(b.person.id);
    });
    orderedByGen[gen] = bloodDescendants;
  }

  // PASS 2: bottom-up layout using the order fixed in pass 1.
  for (var gen = maxGen; gen >= minGen; gen--) {
    final orderedBlood = orderedByGen[gen] ?? [];
    if (orderedBlood.isEmpty) continue;

    final y = (gen - 1) * (kNodeHeight + kVerticalSpacing);
    final units = createUnits(orderedBlood);

    if (gen == maxGen) {
      var x = 0.0;
      for (final unit in units) {
        var memberX = x;
        for (final member in unit.members) {
          positions[member.person.id] = NodePosition(memberX, y, member);
          memberX += kNodeWidth + kSpouseGap;
        }
        x += unitFullWidth(unit);
      }
      continue;
    }

    // Upper generations: prefer centering over already-placed children, but
    // preserve pass-1 sibling order and resolve overlaps by shifting right.
    final unitPositions = <_UnitPos>[];
    for (final unit in units) {
      final memberIds = unit.members.map((m) => m.person.id).toSet();
      final childXs = <double>[];
      for (final memberId in memberIds) {
        for (final person in people) {
          if (person.isSpouseSlot) continue;
          if (person.person.fatherId == memberId || person.person.motherId == memberId) {
            final pos = positions[person.person.id];
            if (pos != null) childXs.add(pos.x + kNodeWidth / 2);
          }
        }
      }

      double? idealX;
      if (childXs.isNotEmpty) {
        final minChildX = childXs.reduce((a, b) => a < b ? a : b);
        final maxChildX = childXs.reduce((a, b) => a > b ? a : b);
        idealX = (minChildX + maxChildX) / 2 - unit.width / 2;
      }
      unitPositions.add(_UnitPos(unit, idealX));
    }

    // Interpolate positions for units with no positioned children (unmarried
    // siblings) — place them between whichever neighboring siblings do have one.
    for (var i = 0; i < unitPositions.length; i++) {
      if (unitPositions[i].idealX != null) continue;

      double? leftX;
      double? rightX;
      var leftIdx = -1;
      var rightIdx = -1;
      for (var j = i - 1; j >= 0; j--) {
        if (unitPositions[j].idealX != null) {
          leftX = unitPositions[j].idealX! + unitPositions[j].unit.width;
          leftIdx = j;
          break;
        }
      }
      for (var j = i + 1; j < unitPositions.length; j++) {
        if (unitPositions[j].idealX != null) {
          rightX = unitPositions[j].idealX;
          rightIdx = j;
          break;
        }
      }

      if (leftX != null && rightX != null) {
        final gap = rightX - leftX;
        final unpositionedCount = rightIdx - leftIdx - 1;
        final posInGap = i - leftIdx;
        final spacing = gap / (unpositionedCount + 1);
        unitPositions[i].idealX = leftX + spacing * posInGap;
      } else if (leftX != null) {
        unitPositions[i].idealX = leftX + kHorizontalSpacing;
      } else if (rightX != null) {
        unitPositions[i].idealX = rightX - unitPositions[i].unit.width - kHorizontalSpacing;
      } else {
        unitPositions[i].idealX = 0;
      }
    }

    final placedUnits = <_PlacedUnit>[];
    for (final up in unitPositions) {
      var x = up.idealX!;
      var needsShift = true;
      while (needsShift) {
        needsShift = false;
        for (final pu in placedUnits) {
          final puRight = pu.x + pu.width + kHorizontalSpacing;
          final upRight = x + up.unit.width;
          if (!(x >= puRight || upRight <= pu.x - kHorizontalSpacing)) {
            x = x > puRight ? x : puRight;
            needsShift = true;
          }
        }
      }
      placedUnits.add(_PlacedUnit(x, up.unit.width));

      var memberX = x;
      for (final member in up.unit.members) {
        positions[member.person.id] = NodePosition(memberX, y, member);
        memberX += kNodeWidth + kSpouseGap;
      }
    }
  }

  // PASS 3: childless spouses sit right next to their partner.
  for (final person in people) {
    if (!person.isSpouseSlot) continue;
    final pos = positions[person.person.id];
    if (pos == null) continue;

    final partnerId = person.person.spouseId;
    if (partnerId == null) continue;
    final partnerPos = positions[partnerId];
    if (partnerPos == null) continue;

    final hasChildren = people.any((p) =>
        !p.isSpouseSlot &&
        (p.person.fatherId == person.person.id || p.person.motherId == person.person.id));

    if (!hasChildren) {
      pos.x = partnerPos.x + kNodeWidth + kSpouseGap;
    }
  }

  // Normalize so the leftmost node sits at x = 0.
  var minX = double.infinity;
  for (final pos in positions.values) {
    if (pos.x < minX) minX = pos.x;
  }
  if (minX.isFinite && minX != 0) {
    for (final pos in positions.values) {
      pos.x -= minX;
    }
  }

  return positions;
}
