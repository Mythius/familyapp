import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../core/auth_state.dart';

class _Destination {
  const _Destination(this.path, this.icon, this.label);
  final String path;
  final IconData icon;
  final String label;
}

const _destinations = [
  _Destination('/', Icons.search, 'Search'),
  _Destination('/tree', Icons.account_tree, 'Tree'),
  _Destination('/calendar', Icons.cake, 'Calendar'),
  _Destination('/browse', Icons.table_rows, 'Browse'),
  _Destination('/settings', Icons.settings, 'Settings'),
];

/// Shared scaffold for every authenticated screen: an adaptive nav (rail on
/// wide viewports, bottom bar on narrow ones) plus a sign-out action.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.auth, required this.child});
  final AuthState auth;
  final Widget child;

  int _indexForLocation(String location) {
    if (location.startsWith('/person')) return 0;
    final i = _destinations.indexWhere((d) => d.path == location);
    return i < 0 ? 0 : i;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final index = _indexForLocation(location);
    final wide = MediaQuery.sizeOf(context).width >= 800;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Family Registry'),
        actions: [
          if (auth.displayName != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Center(child: Text(auth.displayName!)),
            ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: auth.logout,
          ),
        ],
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: index,
                  onDestinationSelected: (i) => context.go(_destinations[i].path),
                  labelType: NavigationRailLabelType.all,
                  destinations: _destinations
                      .map((d) => NavigationRailDestination(
                            icon: Icon(d.icon),
                            label: Text(d.label),
                          ))
                      .toList(),
                ),
                const VerticalDivider(width: 1),
                Expanded(child: child),
              ],
            )
          : child,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (i) => context.go(_destinations[i].path),
              destinations: _destinations
                  .map((d) => NavigationDestination(icon: Icon(d.icon), label: d.label))
                  .toList(),
            ),
    );
  }
}
