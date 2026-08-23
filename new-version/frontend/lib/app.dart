import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'core/api_client.dart';
import 'core/auth_state.dart';
import 'screens/app_shell.dart';
import 'screens/browse_screen.dart';
import 'screens/calendar_screen.dart';
import 'screens/login_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/search_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/tree_screen.dart';

class FamilyRegistryApp extends StatefulWidget {
  const FamilyRegistryApp({super.key});

  @override
  State<FamilyRegistryApp> createState() => _FamilyRegistryAppState();
}

class _FamilyRegistryAppState extends State<FamilyRegistryApp> {
  late final ApiClient _api;
  late final AuthState _auth;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _api = ApiClient();
    _auth = AuthState(_api);
    _router = GoRouter(
      refreshListenable: _auth,
      initialLocation: '/',
      redirect: (context, state) {
        if (_auth.isLoading) return null;
        final loggingIn = state.matchedLocation == '/login';
        if (!_auth.isAuthenticated) return loggingIn ? null : '/login';
        if (loggingIn) return '/';
        return null;
      },
      routes: [
        GoRoute(path: '/login', builder: (context, state) => LoginScreen(api: _api, auth: _auth)),
        ShellRoute(
          builder: (context, state, child) => AppShell(auth: _auth, child: child),
          routes: [
            GoRoute(path: '/', builder: (context, state) => SearchScreen(api: _api, auth: _auth)),
            GoRoute(
              path: '/person/:name',
              builder: (context, state) => ProfileScreen(
                api: _api,
                auth: _auth,
                name: state.pathParameters['name']!,
              ),
            ),
            GoRoute(
              path: '/tree',
              builder: (context, state) => TreeScreen(
                api: _api,
                auth: _auth,
                initialPersonName: state.uri.queryParameters['person'],
              ),
            ),
            GoRoute(path: '/calendar', builder: (context, state) => CalendarScreen(api: _api)),
            GoRoute(path: '/browse', builder: (context, state) => BrowseScreen(api: _api)),
            GoRoute(
              path: '/settings',
              builder: (context, state) => SettingsScreen(api: _api, auth: _auth),
            ),
          ],
        ),
      ],
    );
    _init();
  }

  Future<void> _init() async {
    // Mobile has no cookie jar — restore a previously-stored session token
    // (if any) before the first /user check, or every launch would look
    // logged-out even right after a successful sign-in.
    if (!kIsWeb) await _auth.restoreMobileSession();
    await _auth.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true);
    final darkTheme = ThemeData(
      colorSchemeSeed: Colors.indigo,
      brightness: Brightness.dark,
      useMaterial3: true,
    );

    // Block on the initial session check so the very first frame doesn't
    // briefly render (and fetch data for) a screen the redirect will just
    // replace a moment later once _auth.isLoading flips.
    return ListenableBuilder(
      listenable: _auth,
      builder: (context, _) {
        if (_auth.isLoading) {
          return MaterialApp(
            title: 'Family Registry',
            debugShowCheckedModeBanner: false,
            theme: theme,
            darkTheme: darkTheme,
            home: const Scaffold(body: Center(child: CircularProgressIndicator())),
          );
        }
        return MaterialApp.router(
          title: 'Family Registry',
          debugShowCheckedModeBanner: false,
          theme: theme,
          darkTheme: darkTheme,
          routerConfig: _router,
        );
      },
    );
  }
}
