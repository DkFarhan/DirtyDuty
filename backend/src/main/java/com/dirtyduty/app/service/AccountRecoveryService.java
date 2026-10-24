package com.dirtyduty.app.service;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AccountRecoveryService {
  private final UserRepository userRepository;
  private final PasswordResetService passwordResetService;
  private final EmailVerificationService emailVerificationService;
  private final boolean emailVerificationEnabled;

  public AccountRecoveryService(
      UserRepository userRepository,
      PasswordResetService passwordResetService,
      EmailVerificationService emailVerificationService,
      @Value("${app.auth.email-verification.enabled:false}") boolean emailVerificationEnabled) {
    this.userRepository = userRepository;
    this.passwordResetService = passwordResetService;
    this.emailVerificationService = emailVerificationService;
    this.emailVerificationEnabled = emailVerificationEnabled;
  }

  public String requestInstructions(String submittedEmail, String sourceIp) {
    String email = submittedEmail == null ? "" : submittedEmail.trim().toLowerCase(Locale.ROOT);
    if (emailVerificationEnabled) {
      User user = userRepository.findByEmailIgnoreCase(email).orElse(null);
      if (user == null || user.getEmailVerifiedAt() == null) {
        emailVerificationService.requestRecovery(email, sourceIp);
        return passwordResetService.genericResponse();
      }
    }
    return passwordResetService.request(email, sourceIp);
  }
}
