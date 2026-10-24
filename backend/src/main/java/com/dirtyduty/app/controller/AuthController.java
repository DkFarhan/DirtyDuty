package com.dirtyduty.app.controller;

import com.dirtyduty.app.config.AuthFeatureConfiguration;
import com.dirtyduty.app.dto.auth.AuthProvidersResponse;
import com.dirtyduty.app.dto.auth.ChangePasswordRequest;
import com.dirtyduty.app.dto.auth.CompleteEmailVerificationRecoveryRequest;
import com.dirtyduty.app.dto.auth.CorrectPendingEmailRequest;
import com.dirtyduty.app.dto.auth.CsrfResponse;
import com.dirtyduty.app.dto.auth.DeleteAccountRequest;
import com.dirtyduty.app.dto.auth.EmailVerificationRecoveryRequest;
import com.dirtyduty.app.dto.auth.EmailVerificationStatusResponse;
import com.dirtyduty.app.dto.auth.GoogleLinkRequest;
import com.dirtyduty.app.dto.auth.LegalAcceptanceRequest;
import com.dirtyduty.app.dto.auth.LegalAcceptanceResponse;
import com.dirtyduty.app.dto.auth.LoginRequest;
import com.dirtyduty.app.dto.auth.LoginResponse;
import com.dirtyduty.app.dto.auth.PasswordResetConfirmRequest;
import com.dirtyduty.app.dto.auth.PasswordResetRequest;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.dto.auth.VerifyEmailRequest;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.exception.EmailVerificationRateLimitException;
import com.dirtyduty.app.exception.PasswordResetSamePasswordException;
import com.dirtyduty.app.repository.UserRepository;
import com.dirtyduty.app.service.AuthService;
import com.dirtyduty.app.service.EmailVerificationService;
import com.dirtyduty.app.service.GoogleIdentityService;
import com.dirtyduty.app.service.LegalAcceptanceService;
import com.dirtyduty.app.service.PasswordLoginProtectionService;
import com.dirtyduty.app.service.PasswordResetService;
import com.dirtyduty.app.service.RecentReauthenticationService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

  private final AuthService authService;
  private final AuthenticationManager authenticationManager;
  private final SecurityContextRepository securityContextRepository;
  private final SessionAuthenticationStrategy sessionAuthenticationStrategy;
  private final UserRepository userRepository;
  private final GoogleIdentityService googleIdentityService;
  private final PasswordResetService passwordResetService;
  private final AuthFeatureConfiguration authFeatures;
  private final RecentReauthenticationService recentReauthenticationService;
  private final LegalAcceptanceService legalAcceptanceService;
  private final PasswordLoginProtectionService loginProtection;
  private final EmailVerificationService emailVerificationService;

  public AuthController(
      AuthService authService,
      AuthenticationManager authenticationManager,
      SecurityContextRepository securityContextRepository,
      SessionAuthenticationStrategy sessionAuthenticationStrategy,
      UserRepository userRepository,
      GoogleIdentityService googleIdentityService,
      PasswordResetService passwordResetService,
      AuthFeatureConfiguration authFeatures,
      RecentReauthenticationService recentReauthenticationService,
      LegalAcceptanceService legalAcceptanceService,
      PasswordLoginProtectionService loginProtection,
      EmailVerificationService emailVerificationService) {
    this.authService = authService;
    this.authenticationManager = authenticationManager;
    this.securityContextRepository = securityContextRepository;
    this.sessionAuthenticationStrategy = sessionAuthenticationStrategy;
    this.userRepository = userRepository;
    this.googleIdentityService = googleIdentityService;
    this.passwordResetService = passwordResetService;
    this.authFeatures = authFeatures;
    this.recentReauthenticationService = recentReauthenticationService;
    this.legalAcceptanceService = legalAcceptanceService;
    this.loginProtection = loginProtection;
    this.emailVerificationService = emailVerificationService;
  }

  @PostMapping("/register")
  public ResponseEntity<RegisterResponse> register(
      @Valid @RequestBody RegisterRequest request,
      HttpServletRequest httpRequest,
      HttpServletResponse httpResponse) {
    RegisterResponse response = authService.register(request);
    String deliveryState = null;
    if (emailVerificationService.isEnabled()) {
      try {
        deliveryState =
            emailVerificationService.sendInitial(response.userId(), httpRequest.getRemoteAddr());
      } catch (EmailVerificationRateLimitException exception) {
        deliveryState = "FAILED";
      }
    }
    Authentication authentication =
        authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.email().trim().toLowerCase(Locale.ROOT), request.password()));
    establishSession(authentication, httpRequest, httpResponse);
    boolean verified = !emailVerificationService.isEnabled();
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            new RegisterResponse(
                response.userId(),
                response.displayName(),
                response.email(),
                verified,
                deliveryState));
  }

  @GetMapping("/csrf")
  public CsrfResponse csrf(CsrfToken csrfToken) {
    return new CsrfResponse(csrfToken.getToken(), csrfToken.getHeaderName());
  }

  @PostMapping("/legal-acceptance")
  public LegalAcceptanceResponse acceptLegalDocuments(
      @Valid @RequestBody LegalAcceptanceRequest request, Authentication authentication) {
    return legalAcceptanceService.acceptCurrentVersions(authentication.getName());
  }

  @GetMapping("/providers")
  public AuthProvidersResponse providers() {
    return new AuthProvidersResponse(
        authFeatures.googleEnabled(),
        authFeatures.passwordResetEnabled(),
        authFeatures.emailVerificationEnabled());
  }

  @GetMapping("/email-verification/status")
  public EmailVerificationStatusResponse emailVerificationStatus(Authentication authentication) {
    return emailVerificationService.status(authentication.getName());
  }

  @PostMapping("/email-verification/resend")
  public EmailVerificationStatusResponse resendVerificationCode(
      Authentication authentication, HttpServletRequest request) {
    emailVerificationService.resend(authentication.getName(), request.getRemoteAddr());
    return emailVerificationService.status(authentication.getName());
  }

  @PostMapping("/email-verification/verify")
  public ResponseEntity<Void> verifyEmail(
      @Valid @RequestBody VerifyEmailRequest request,
      Authentication authentication,
      HttpServletRequest httpRequest) {
    if (!emailVerificationService.verify(
        authentication.getName(), request.code(), httpRequest.getRemoteAddr())) {
      throw new com.dirtyduty.app.exception.EmailVerificationInvalidCodeException();
    }
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/email-verification/correct-email")
  public ResponseEntity<Void> correctPendingEmail(
      @Valid @RequestBody CorrectPendingEmailRequest request,
      Authentication authentication,
      HttpServletRequest httpRequest) {
    authenticatePassword(authentication.getName(), request.password(), httpRequest.getRemoteAddr());
    emailVerificationService.correctPendingEmail(authentication.getName(), request.email());
    SecurityContextHolder.clearContext();
    if (httpRequest.getSession(false) != null) httpRequest.getSession(false).invalidate();
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/email-verification/recovery/request")
  public ResponseEntity<java.util.Map<String, String>> requestEmailVerificationRecovery(
      @Valid @RequestBody EmailVerificationRecoveryRequest request,
      HttpServletRequest httpRequest) {
    emailVerificationService.requestRecovery(request.email(), httpRequest.getRemoteAddr());
    return ResponseEntity.ok(
        java.util.Map.of(
            "message",
            "If an eligible account exists for this email, a recovery code will be sent."));
  }

  @PostMapping("/email-verification/recovery/complete")
  public ResponseEntity<LoginResponse> completeEmailVerificationRecovery(
      @Valid @RequestBody CompleteEmailVerificationRecoveryRequest request,
      HttpServletRequest httpRequest,
      HttpServletResponse httpResponse) {
    User user =
        emailVerificationService.completeRecovery(
            request.email(),
            request.code(),
            request.newPassword(),
            request.displayName(),
            httpRequest.getRemoteAddr());
    Authentication authentication =
        authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(user.getEmail(), request.newPassword()));
    establishSession(authentication, httpRequest, httpResponse);
    return ResponseEntity.ok(loginResponse(user));
  }

  @PostMapping("/password-reset/request")
  public ResponseEntity<java.util.Map<String, String>> requestPasswordReset(
      @Valid @RequestBody PasswordResetRequest request, HttpServletRequest httpRequest) {
    String message = passwordResetService.request(request.email(), httpRequest.getRemoteAddr());
    return ResponseEntity.ok(java.util.Map.of("message", message));
  }

  @PostMapping("/password-reset/confirm")
  public ResponseEntity<java.util.Map<String, String>> confirmPasswordReset(
      @Valid @RequestBody PasswordResetConfirmRequest request, HttpServletRequest httpRequest) {
    boolean changed;
    try {
      changed =
          passwordResetService.confirm(
              request.token(), request.newPassword(), httpRequest.getRemoteAddr());
    } catch (PasswordResetSamePasswordException exception) {
      return ResponseEntity.badRequest().body(java.util.Map.of("message", exception.getMessage()));
    }
    if (!changed) {
      return ResponseEntity.badRequest()
          .body(java.util.Map.of("message", "This reset link is invalid or expired."));
    }
    return ResponseEntity.ok(java.util.Map.of("message", "Password changed successfully."));
  }

  @PostMapping("/google/link")
  public ResponseEntity<Void> linkGoogleAccount(
      @Valid @RequestBody GoogleLinkRequest request,
      HttpServletRequest httpRequest,
      HttpServletResponse httpResponse) {
    var session = httpRequest.getSession(false);
    if (session == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    Object subject = session.getAttribute(GoogleIdentityService.PENDING_SUBJECT);
    Object email = session.getAttribute(GoogleIdentityService.PENDING_EMAIL);
    Object created = session.getAttribute(GoogleIdentityService.PENDING_CREATED);
    if (!(subject instanceof String providerSubject)
        || !(email instanceof String verifiedEmail)
        || !(created instanceof Long createdAt)
        || Instant.now().toEpochMilli() - createdAt > 10 * 60 * 1000) {
      clearPendingLink(session);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }

    try {
      Authentication authentication =
          authenticatePassword(verifiedEmail, request.password(), httpRequest.getRemoteAddr());
      googleIdentityService.linkToPasswordAccount(providerSubject, verifiedEmail);
      sessionAuthenticationStrategy.onAuthentication(authentication, httpRequest, httpResponse);
      session.removeAttribute(GoogleIdentityService.PENDING_SUBJECT);
      session.removeAttribute(GoogleIdentityService.PENDING_EMAIL);
      session.removeAttribute(GoogleIdentityService.PENDING_CREATED);
      session.setAttribute(
          GoogleIdentityService.REAUTHENTICATION_TIME, Instant.now().toEpochMilli());
      SecurityContext context = SecurityContextHolder.createEmptyContext();
      context.setAuthentication(authentication);
      SecurityContextHolder.setContext(context);
      securityContextRepository.saveContext(context, httpRequest, httpResponse);
      return ResponseEntity.noContent().build();
    } catch (BadCredentialsException exception) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unable to link Google account.");
    } catch (DataIntegrityViolationException exception) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Unable to link Google account.");
    }
  }

  @GetMapping("/google/reauthenticate")
  public ResponseEntity<Void> reauthenticateWithGoogle(
      Authentication authentication,
      HttpServletRequest request,
      @RequestParam(defaultValue = "privacy-security") String returnTo) {
    if (!authFeatures.googleEnabled()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
    if (!returnTo.equals("privacy-security") && !returnTo.equals("household-settings")) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    }
    var session = request.getSession(true);
    session.removeAttribute(GoogleIdentityService.REAUTHENTICATION_TIME);
    session.setAttribute(GoogleIdentityService.OAUTH_INTENT, true);
    session.setAttribute(GoogleIdentityService.PENDING_EMAIL, authentication.getName());
    session.setAttribute(GoogleIdentityService.REAUTH_RETURN_SCREEN, returnTo);
    return ResponseEntity.status(HttpStatus.FOUND)
        .header("Location", "/api/auth/oauth2/authorization/google")
        .build();
  }

  @PostMapping("/login")
  public LoginResponse login(
      @Valid @RequestBody LoginRequest request,
      HttpServletRequest httpRequest,
      HttpServletResponse httpResponse) {
    String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
    Authentication authentication =
        authenticatePassword(normalizedEmail, request.password(), httpRequest.getRemoteAddr());

    establishSession(authentication, httpRequest, httpResponse);

    User user =
        userRepository
            .findByEmailIgnoreCase(normalizedEmail)
            .orElseThrow(() -> new IllegalStateException("Authenticated user is unavailable"));
    return loginResponse(user);
  }

  private void establishSession(
      Authentication authentication,
      HttpServletRequest httpRequest,
      HttpServletResponse httpResponse) {
    sessionAuthenticationStrategy.onAuthentication(authentication, httpRequest, httpResponse);
    SecurityContext context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(authentication);
    SecurityContextHolder.setContext(context);
    securityContextRepository.saveContext(context, httpRequest, httpResponse);
  }

  private Authentication authenticatePassword(String email, String password, String sourceIp) {
    PasswordAuthenticationResult result =
        loginProtection.withAdmissionLock(
            email,
            sourceIp,
            () -> {
              loginProtection.assertAllowed(email, sourceIp);
              try {
                Authentication authentication =
                    authenticationManager.authenticate(
                        new UsernamePasswordAuthenticationToken(email, password));
                loginProtection.clearAccountFailures(email);
                return new PasswordAuthenticationResult(authentication, null);
              } catch (BadCredentialsException exception) {
                loginProtection.recordFailure(email, sourceIp);
                return new PasswordAuthenticationResult(null, exception);
              }
            });
    if (result.failure() != null) {
      throw result.failure();
    }
    return result.authentication();
  }

  private record PasswordAuthenticationResult(
      Authentication authentication, BadCredentialsException failure) {}

  @GetMapping("/me")
  public LoginResponse me(Authentication authentication) {
    User user =
        userRepository
            .findByEmailIgnoreCase(authentication.getName())
            .orElseThrow(() -> new IllegalStateException("Authenticated user is unavailable"));
    return loginResponse(user);
  }

  private LoginResponse loginResponse(User user) {
    List<String> providers = new ArrayList<>();
    if (user.getPasswordHash() != null) providers.add("PASSWORD");
    if (googleIdentityService.hasGoogleIdentity(user.getId())) providers.add("GOOGLE");
    return new LoginResponse(
        user.getId(),
        user.getDisplayName(),
        user.getEmail(),
        user.getEmailVerifiedAt() != null,
        user.getPasswordHash() != null,
        List.copyOf(providers),
        legalAcceptanceService.isAcceptanceRequired(user));
  }

  private void clearPendingLink(jakarta.servlet.http.HttpSession session) {
    session.removeAttribute(GoogleIdentityService.PENDING_SUBJECT);
    session.removeAttribute(GoogleIdentityService.PENDING_EMAIL);
    session.removeAttribute(GoogleIdentityService.PENDING_CREATED);
  }

  @PostMapping("/change-password")
  public ResponseEntity<Void> changePassword(
      @Valid @RequestBody ChangePasswordRequest request, Authentication authentication) {
    authService.changePassword(
        authentication.getName(), request.currentPassword(), request.newPassword());
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/delete-account")
  public ResponseEntity<Void> deleteAccount(
      @Valid @RequestBody DeleteAccountRequest request,
      Authentication authentication,
      HttpServletRequest httpRequest) {
    boolean recent = recentReauthenticationService.consume(httpRequest);
    authService.deleteAccount(
        authentication.getName(), request.password(), request.email(), recent);
    SecurityContextHolder.clearContext();
    if (httpRequest.getSession(false) != null) {
      httpRequest.getSession(false).invalidate();
    }
    return ResponseEntity.noContent().build();
  }
}
