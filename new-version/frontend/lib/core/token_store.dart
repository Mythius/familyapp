import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the session token on mobile, where there's no browser cookie
/// jar to hold it — see auth_state.dart's `signInWithGoogleMobile`.
class TokenStore {
  TokenStore._();
  static const _key = 'auth_token';
  static const _storage = FlutterSecureStorage();

  static Future<String?> read() => _storage.read(key: _key);
  static Future<void> write(String token) => _storage.write(key: _key, value: token);
  static Future<void> delete() => _storage.delete(key: _key);
}
