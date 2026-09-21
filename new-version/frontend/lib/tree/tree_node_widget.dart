import 'package:flutter/material.dart';
import 'tree_layout.dart';

class TreeNodeWidget extends StatelessWidget {
  const TreeNodeWidget({super.key, required this.node, required this.onTap});
  final TreeNode node;
  final VoidCallback onTap;

  static const _male = (fill: Color(0xFFA8D5E8), border: Color(0xFF5A9FC7));
  static const _female = (fill: Color(0xFFF5C6D6), border: Color(0xFFD4879C));
  static const _unknown = (fill: Color(0xFFE0E0E0), border: Color(0xFF999999));

  @override
  Widget build(BuildContext context) {
    final colors = switch (node.person.gender) {
      'Male' => _male,
      'Female' => _female,
      _ => _unknown,
    };

    return GestureDetector(
      onTap: onTap,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: Container(
          width: kNodeWidth,
          height: kNodeHeight,
          padding: const EdgeInsets.fromLTRB(6, 4, 6, 2),
          decoration: BoxDecoration(
            color: colors.fill,
            border: Border.all(color: colors.border, width: 2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Stack(
            children: [
              Align(
                alignment: Alignment.topLeft,
                child: Text(
                  node.generation,
                  style: const TextStyle(fontSize: 10, color: Color(0xFF666666)),
                ),
              ),
              Center(
                child: Text(
                  node.person.name ?? '',
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: Color(0xFF333333)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
