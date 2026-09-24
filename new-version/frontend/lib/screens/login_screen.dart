import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_client.dart';
import '../core/auth_state.dart';

/// Web: a full-page redirect to the backend's `/auth/google` route, which
/// (per this deployment's CAS configuration) itself redirects to the
/// external CAS server. There's nothing to do here after the click — the CAS
/// callback sets the session cookie and redirects back to `/`, where
/// AuthState.refresh() picks up the now-valid session on app start.
///
/// Mobile: native Google sign-in instead (see AuthState.signInWithGoogleMobile)
/// — there's no browser cookie jar on a native app for a CAS-set session
/// cookie to land in, so mobile skips CAS entirely.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.auth});
  final ApiClient api;
  final AuthState auth;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _signingIn = false;

  Future<void> _signInWeb(String provider) async {
    final uri = Uri.parse('${widget.api.baseUrl}/auth/$provider');
    await launchUrl(uri, webOnlyWindowName: '_self');
  }

  Future<void> _signInMobile() async {
    setState(() => _signingIn = true);
    final ok = await widget.auth.signInWithGoogleMobile();
    if (!mounted) return;
    setState(() => _signingIn = false);
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sign-in failed. Please try again.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipOval(
              child: Image.asset(
                'assets/icon/app_icon.png',
                width: 96,
                height: 96,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _signingIn
                  ? null
                  : (kIsWeb ? () => _signInWeb('google') : _signInMobile),
              icon: _signingIn
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.login),
              label: const Text('Sign in with Google'),
            ),
            // Email sign-in goes through CAS, whose cookie-based session has
            // no equivalent on mobile — so it's web-only.
            if (kIsWeb) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => _signInWeb('email'),
                icon: const Icon(Icons.email_outlined),
                label: const Text('Sign in with email'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
