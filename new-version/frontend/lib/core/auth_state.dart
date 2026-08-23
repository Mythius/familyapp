import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'api_client.dart';
import 'token_store.dart';

/// Session state for the signed-in user: their identity (`/user`) and their
/// account row + per-family permissions (`/permissions`). Recomputed on
/// [refresh] rather than mutated in place, so a stale role/grant never lingers
/// after a permission change elsewhere.
class AuthState extends ChangeNotifier {
  AuthState(this._api) {
    _api.onInvalidToken = _forceLogout;
  }
  final ApiClient _api;
  bool _forcingLogout = false;

  // Google Cloud's "Web application" OAuth client — the same one the
  // prototype used for its own direct-Google-OAuth login. Reused here as
  // `serverClientId` so the ID token google_sign_in returns on mobile has an
  // `aud` claim the backend can verify (it checks against this same value
  // via the GOOGLE_CLIENT_ID env var — the two must match). Mobile skips the
  // CAS delegation the web build uses entirely; there's no browser cookie
  // jar on a native app for a CAS-set session cookie to land in anyway.
  static const _googleServerClientId =
      '1016767921529-6ht5kllaqo7627qcb9p7fv7vilc66aos.apps.googleusercontent.com';

  // Lazy and mobile-only: constructing GoogleSignIn also registers its web
  // plugin's JS SDK init on the web platform, which web never uses (it goes
  // through CAS instead) and which fails outside a real browser context —
  // so it's never touched unless a mobile method below actually needs it.
  GoogleSignIn? _googleSignInInstance;
  GoogleSignIn get _googleSignIn => _googleSignInInstance ??= GoogleSignIn(
    scopes: ['email'],
    serverClientId: _googleServerClientId,
  );

  bool isLoading = true;
  bool isAuthenticated = false;
  Map<String, dynamic>? profile;
  Map<String, dynamic>? account;

  String? get email => profile?['email'] as String?;
  String? get displayName =>
      (profile?['name'] ?? profile?['username'] ?? email) as String?;
  String? get photoUrl => profile?['picture'] as String?;

  Map<String, dynamic> get familyPermissions =>
      (account?['family_permissions'] as Map?)?.cast<String, dynamic>() ?? {};

  bool canEdit(String familyId) {
    final role = familyPermissions[familyId];
    return role == 'owner' || role == 'editor';
  }

  bool isOwner(String familyId) => familyPermissions[familyId] == 'owner';

  List<String> get editableFamilyIds => familyPermissions.entries
      .where((e) => e.value == 'owner' || e.value == 'editor')
      .map((e) => e.key)
      .toList();

  /// Restores a previously-stored mobile session token, if any — call once
  /// at app startup (mobile only) before the first [refresh].
  Future<void> restoreMobileSession() async {
    final token = await TokenStore.read();
    if (token != null) _api.setToken(token);
  }

  /// Native Google sign-in for mobile. Posts the ID token to the same
  /// `/auth/google-oneclick` endpoint the web one-tap flow already uses,
  /// then stores the session token it returns for subsequent requests.
  /// Returns false on cancellation or failure (nothing to show the user
  /// beyond staying on the login screen — Google's own picker already
  /// surfaces cancellation, and a generic retry is the right move for any
  /// real failure here).
  Future<bool> signInWithGoogleMobile() async {
    try {
      final googleAccount = await _googleSignIn.signIn();
      if (googleAccount == null) return false;
      final googleAuth = await googleAccount.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) return false;

      final response = await _api.post('/auth/google-oneclick', {
        'credential': idToken,
        'email': googleAccount.email,
        'name': googleAccount.displayName ?? googleAccount.email,
      }) as Map;
      final token = response['token'] as String?;
      if (token == null) return false;

      await TokenStore.write(token);
      _api.setToken(token);
      await refresh();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> refresh() async {
    isLoading = true;
    notifyListeners();
    try {
      final user = await _api.get('/user') as Map;
      profile = user.cast<String, dynamic>();
      isAuthenticated = true;
      try {
        final perms = await _api.get('/permissions') as Map;
        account = perms.cast<String, dynamic>();
      } catch (_) {
        account = null;
      }
    } catch (_) {
      isAuthenticated = false;
      profile = null;
      account = null;
    }
    isLoading = false;
    notifyListeners();
  }

  /// Logs out because the server just told us (via [ApiClient.onInvalidToken])
  /// that the session we're holding is already dead — skips the best-effort
  /// `DELETE /auth` call, since that would just fail the same way, and
  /// guards against being called again by other requests failing the same
  /// way while this is still in flight.
  void _forceLogout() {
    if (_forcingLogout) return;
    _forcingLogout = true;
    logout(notifyServer: false).whenComplete(() => _forcingLogout = false);
  }

  Future<void> logout({bool notifyServer = true}) async {
    if (notifyServer) {
      try {
        await _api.delete('/auth');
      } catch (_) {
        // best-effort — clear local state regardless
      }
    }
    if (!kIsWeb) {
      await TokenStore.delete();
      _api.setToken(null);
      try {
        await _googleSignIn.signOut();
      } catch (_) {
        // not signed in via Google this session — nothing to undo
      }
    }
    isAuthenticated = false;
    profile = null;
    account = null;
    notifyListeners();
  }
}
