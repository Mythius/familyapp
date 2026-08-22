import '../models/person.dart';

/// Depth-first "family order", ported from the prototype's `computeTreeOrder`
/// (main.js): root(s) -> spouse -> children in birth order, recursing fully
/// into each child's subtree before moving to the next sibling. Returns
/// personId -> 1-based position in that traversal, computed over the full
/// people list (not a filtered subset) so ordering stays correct regardless
/// of active filters. If [rootId] is given (the "Descendants of" person), the
/// walk starts there instead of at every genealogical root.
Map<int, int> computeTreeOrder(List<Person> people, {int? rootId}) {
  final byId = {for (final p in people) p.id: p};

  final spouseMap = <int, Set<int>>{};
  void linkSpouses(int a, int b) => spouseMap.putIfAbsent(a, () => {}).add(b);

  final childrenMap = <int, List<Person>>{};
  void linkChild(int? parentId, Person child) {
    if (parentId == null) return;
    childrenMap.putIfAbsent(parentId, () => []).add(child);
  }

  for (final p in people) {
    final spouseId = p.spouseId;
    if (spouseId != null) {
      linkSpouses(p.id, spouseId);
      linkSpouses(spouseId, p.id);
    }
    linkChild(p.fatherId, p);
    linkChild(p.motherId, p);
  }

  // Oldest first; people without a birthdate sort after dated siblings, by id.
  int birthOrder(Person a, Person b) {
    final ad = a.birthday;
    final bd = b.birthday;
    if (ad != null && bd != null) {
      final diff = ad.compareTo(bd);
      if (diff != 0) return diff;
    } else if (ad != null && bd == null) {
      return -1;
    } else if (ad == null && bd != null) {
      return 1;
    }
    return a.id.compareTo(b.id);
  }

  final visited = <int>{};
  final order = <int>[];

  void visit(int? personId) {
    if (personId == null || visited.contains(personId) || !byId.containsKey(personId)) return;
    visited.add(personId);
    order.add(personId);

    final spouses = (spouseMap[personId] ?? const <int>{})
        .where((sid) => byId.containsKey(sid))
        .toList();
    for (final sid in spouses) {
      if (!visited.contains(sid)) {
        visited.add(sid);
        order.add(sid);
      }
    }

    final seenChild = <int>{};
    final children = <Person>[];
    for (final pid in [personId, ...spouses]) {
      for (final child in childrenMap[pid] ?? const <Person>[]) {
        if (seenChild.add(child.id)) children.add(child);
      }
    }
    children.sort(birthOrder);
    for (final child in children) {
      visit(child.id);
    }
  }

  if (rootId != null && byId.containsKey(rootId)) {
    visit(rootId);
  } else {
    final roots = people.where((p) => p.fatherId == null && p.motherId == null).toList()
      ..sort(birthOrder);
    for (final root in roots) {
      visit(root.id);
    }
  }
  // Anything left over (orphaned data, or people outside the chosen root's
  // subtree) still gets an order so every row has a value.
  for (final p in people) {
    visit(p.id);
  }

  return {for (var i = 0; i < order.length; i++) order[i]: i + 1};
}
