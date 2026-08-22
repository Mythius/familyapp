import 'package:flutter/material.dart';
import 'tree_layout.dart';

/// Draws spouse lines (horizontal) and parent-child elbow connectors behind
/// the node widgets, plus the "Gen N" row labels in the left margin —
/// ported from tree.js's `draw()`. Positions passed in are expected to
/// already include the [kGenLabelWidth]/top-padding shift applied by the
/// caller, so this paints in the same coordinate space the node widgets sit in.
class TreeConnectorPainter extends CustomPainter {
  TreeConnectorPainter(this.positions, this.genNumbers);

  final Map<int, NodePosition> positions;
  final List<int> genNumbers;

  static const _spouseColor = Color(0xFFE74C3C);
  static const _childColor = Color(0xFF666666);
  static const _labelColor = Color(0xFF666666);

  @override
  void paint(Canvas canvas, Size size) {
    final spousePaint = Paint()
      ..color = _spouseColor
      ..strokeWidth = 2;
    final childPaint = Paint()
      ..color = _childColor
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    for (final gen in genNumbers) {
      final y = (gen - 1) * (kNodeHeight + kVerticalSpacing) + kNodeHeight / 2;
      final tp = TextPainter(
        text: TextSpan(
          text: 'Gen $gen',
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: _labelColor),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: kGenLabelWidth - 8);
      tp.paint(canvas, Offset(kGenLabelWidth - 8 - tp.width, y - tp.height / 2));
    }

    final drawnSpouseLines = <String>{};
    for (final pos in positions.values) {
      final spouseId = pos.node.person.spouseId;
      if (spouseId == null || !positions.containsKey(spouseId)) continue;
      final ids = [pos.node.person.id, spouseId]..sort();
      final key = '${ids[0]}-${ids[1]}';
      if (!drawnSpouseLines.add(key)) continue;

      final other = positions[spouseId]!;
      final y = pos.y + kNodeHeight / 2;
      final x1 = (pos.x < other.x ? pos.x : other.x) + kNodeWidth;
      final x2 = pos.x > other.x ? pos.x : other.x;
      if (x2 > x1) {
        canvas.drawLine(Offset(x1, y), Offset(x2, y), spousePaint);
      }
    }

    for (final pos in positions.values) {
      final node = pos.node;
      if (node.isSpouseSlot) continue;
      final person = node.person;

      final parents = <NodePosition>[];
      if (person.fatherId != null && positions.containsKey(person.fatherId)) {
        parents.add(positions[person.fatherId]!);
      }
      if (person.motherId != null && positions.containsKey(person.motherId)) {
        parents.add(positions[person.motherId]!);
      }
      if (parents.isEmpty) continue;

      final parentX = parents.length == 2
          ? (parents[0].x + parents[1].x + kNodeWidth) / 2
          : parents[0].x + kNodeWidth / 2;
      final parentY = parents[0].y + kNodeHeight;
      final childX = pos.x + kNodeWidth / 2;
      final childY = pos.y;
      final midY = parentY + (childY - parentY) / 2;

      final path = Path()
        ..moveTo(parentX, parentY)
        ..lineTo(parentX, midY)
        ..lineTo(childX, midY)
        ..lineTo(childX, childY);
      canvas.drawPath(path, childPaint);
    }
  }

  @override
  bool shouldRepaint(covariant TreeConnectorPainter oldDelegate) =>
      !identical(oldDelegate.positions, positions);
}
