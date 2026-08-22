import 'dart:convert';
import 'package:http/http.dart' as http;

/// Thrown for any non-2xx response. [message] is the backend's `error` field
/// when present, otherwise a generic status-code message.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

/// Thin JSON HTTP client for the api-lib backend.
///
/// Defaults to relative paths (same origin as this app) — the intended web
/// deployment is this Flutter web build served out of the backend's
/// `public/` folder, so browser cookies (the `auth_token` session cookie)
/// are sent automatically with no CORS configuration needed. Override with
/// `--dart-define=API_BASE_URL=http://localhost:3000` only for standalone
/// `flutter run -d chrome` dev iteration against a backend on another origin
/// (which additionally requires enabling CORS + credentials server-side).
///
/// On mobile there's no cookie jar, so [setToken] attaches the session token
/// (captured after a native Google sign-in — see auth_state.dart) as a plain
/// `authorization` header instead; the backend's session middleware already
/// accepts either the cookie or this header.
class ApiClient {
  ApiClient({String? baseUrl})
      : baseUrl = baseUrl ??
            const String.fromEnvironment('API_BASE_URL', defaultValue: '');

  final String baseUrl;
  final http.Client _client = http.Client();
  String? _token;

  void setToken(String? token) => _token = token;

  Future<dynamic> get(String path) => _send('GET', path);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body);
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body);
  Future<dynamic> delete(String path) => _send('DELETE', path);

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    request.headers['Content-Type'] = 'application/json';
    request.headers['Accept'] = 'application/json';
    if (_token != null) request.headers['authorization'] = _token!;
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);

    dynamic data;
    if (response.body.isNotEmpty) {
      try {
        data = jsonDecode(response.body);
      } catch (_) {
        data = response.body;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    }

    final message = (data is Map && data['error'] != null)
        ? data['error'].toString()
        : 'Request failed (${response.statusCode})';
    throw ApiException(response.statusCode, message);
  }
}
