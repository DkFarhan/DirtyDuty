package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.auth.OwnedHouseholdResponse;
import com.dirtyduty.app.dto.auth.RegisterRequest;
import com.dirtyduty.app.dto.auth.RegisterResponse;
import com.dirtyduty.app.entity.HouseholdMembership;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.entity.enums.HouseholdRole;
import com.dirtyduty.app.entity.enums.MembershipStatus;
import com.dirtyduty.app.exception.AccountDeletionConflictException;
import com.dirtyduty.app.exception.DuplicateResourceException;
import com.dirtyduty.app.exception.EmailVerificationRateLimitException;
import com.dirtyduty.app.exception.InvalidCredentialsException;
import com.dirtyduty.app.repository.HouseholdMembershipRepository;
import com.dirtyduty.app.repository.UserRepository;
import jakarta.transaction.Transactional;
import java.time.Duration;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

  private final UserRepository userRepository;
  private final PasswordEncoder passwordEncoder;
  private final JdbcTemplate jdbcTemplate;
  private final HouseholdMembershipRepository membershipRepository;
  private final HouseholdSettingsService householdSettingsService;
  private final LegalAcceptanceService legalAcceptanceService;
  private final PasswordLoginProtectionService loginProtection;
  private final EmailVerificationService emailVerificationService;
  private final PersistentAuthRateLimiter rateLimiter;

  public AuthService(
      UserRepository userRepository,
      PasswordEncoder passwordEncoder,
      JdbcTemplate jdbcTemplate,
      HouseholdMembershipRepository membershipRepository,
      HouseholdSettingsService householdSettingsService,
      LegalAcceptanceService legalAcceptanceService,
      PasswordLoginProtectionService loginProtection,
      EmailVerificationService emailVerificationService,
      PersistentAuthRateLimiter rateLimiter) {
    this.userRepository = userRepository;
    this.passwordEncoder = passwordEncoder;
    this.jdbcTemplate = jdbcTemplate;
    this.membershipRepository = membershipRepository;
    this.householdSettingsService = householdSettingsService;
    this.legalAcceptanceService = legalAcceptanceService;
    this.loginProtection = loginProtection;
    this.emailVerificationService = emailVerificationService;
    this.rateLimiter = rateLimiter;
  }

  @Transactional
  public RegisterResponse register(RegisterRequest request) {
    return register(request, "direct-service:" + request.email());
  }

  @Transactional
  public RegisterResponse register(RegisterRequest request, String sourceIp) {
    String normalizedEmail = request.email().trim().toLowerCase(Locale.ROOT);
    String normalizedDisplayName = request.displayName().trim();

    boolean emailHourlyAllowed =
        rateLimiter.allow("REGISTER_EMAIL_HOURLY", normalizedEmail, 5, Duration.ofHours(1));
    boolean emailDailyAllowed =
        rateLimiter.allow("REGISTER_EMAIL_DAILY", normalizedEmail, 10, Duration.ofDays(1));
    boolean ipHourlyAllowed =
        rateLimiter.allow("REGISTER_IP_HOURLY", sourceIp, 60, Duration.ofHours(1));
    boolean ipDailyAllowed =
        rateLimiter.allow("REGISTER_IP_DAILY", sourceIp, 200, Duration.ofDays(1));
    if (!emailHourlyAllowed || !emailDailyAllowed || !ipHourlyAllowed || !ipDailyAllowed) {
      throw new EmailVerificationRateLimitException();
    }

    emailVerificationService.reclaimExpiredForEmail(normalizedEmail);
    if (userRepository.existsByEmailIgnoreCase(normalizedEmail)) {
      throw new DuplicateResourceException("A user with this email already exists.");
    }
    emailVerificationService.reserveInitialDelivery(normalizedEmail);

    User user = new User();
    user.setDisplayName(normalizedDisplayName);
    user.setEmail(normalizedEmail);
    user.setPasswordHash(passwordEncoder.encode(request.password()));
    user.setTimezone("UTC");
    user.setAccountStatus(AccountStatus.ACTIVE);
    user.setEmailVerifiedAt(null);
    user.setDisplayNamePersonalizationCompleted(false);
    legalAcceptanceService.acceptForRegistration(user);

    try {
      User savedUser = userRepository.saveAndFlush(user);
      return new RegisterResponse(
          savedUser.getId(), savedUser.getDisplayName(), savedUser.getEmail());
    } catch (DataIntegrityViolationException ex) {
      throw new DuplicateResourceException("A user with this email already exists.");
    }
  }

  @Transactional
  public void changePassword(String email, String currentPassword, String newPassword) {
    User user =
        userRepository
            .findByEmailIgnoreCaseForUpdate(email)
            .orElseThrow(() -> new InvalidCredentialsException("Your account could not be found."));

    requireActive(user);
    if (user.getPasswordHash() == null
        || currentPassword == null
        || !passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
      throw new InvalidCredentialsException("Current password is incorrect.");
    }

    if (newPassword == null || newPassword.length() < 12 || newPassword.length() > 128) {
      throw new InvalidCredentialsException("Password must be between 12 and 128 characters.");
    }
    if (user.getPasswordHash() != null
        && passwordEncoder.matches(newPassword, user.getPasswordHash())) {
      throw new InvalidCredentialsException(
          "New password must be different from your current password.");
    }

    user.setPasswordHash(passwordEncoder.encode(newPassword));
    userRepository.saveAndFlush(user);
    loginProtection.clearAccountFailures(user.getEmail());
    invalidateAllSessionsForUser(email);
  }

  @Transactional
  public void deleteAccount(
      String email, String password, String emailConfirmation, boolean recentlyReauthenticated) {
    User user =
        userRepository
            .findByEmailIgnoreCaseForUpdate(email)
            .orElseThrow(() -> new InvalidCredentialsException("Your account could not be found."));

    requireActive(user);
    if (user.getPasswordHash() == null) {
      if (!recentlyReauthenticated) {
        throw new InvalidCredentialsException("Recent Google reauthentication is required.");
      }
    } else if (password == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
      throw new InvalidCredentialsException("Password is incorrect.");
    }

    if (emailConfirmation == null
        || !user.getEmail()
            .trim()
            .toLowerCase(Locale.ROOT)
            .equals(emailConfirmation.trim().toLowerCase(Locale.ROOT))) {
      throw new InvalidCredentialsException("The email confirmation does not match your account.");
    }

    var activeMemberships =
        membershipRepository.findByUser_IdAndStatusForUpdate(user.getId(), MembershipStatus.ACTIVE);
    var ownedHouseholds =
        activeMemberships.stream()
            .filter(membership -> membership.getRole() == HouseholdRole.OWNER)
            .map(
                membership ->
                    new OwnedHouseholdResponse(
                        membership.getHousehold().getId(), membership.getHousehold().getName()))
            .toList();
    if (!ownedHouseholds.isEmpty()) {
      throw new AccountDeletionConflictException(ownedHouseholds);
    }

    for (HouseholdMembership membership : activeMemberships) {
      householdSettingsService.leaveForAccountDeletion(membership);
    }

    invalidatePersonalData(user.getId(), email);
    String deletedEmail = "deleted-" + UUID.randomUUID() + "@deleted.local";
    user.setEmail(deletedEmail);
    user.setDisplayName("Deleted User");
    user.setAvatarUrl(null);
    user.setTimezone("UTC");
    user.setPasswordHash(passwordEncoder.encode(UUID.randomUUID().toString()));
    user.setAccountStatus(AccountStatus.DELETED);
    user.setEmailVerifiedAt(null);
    userRepository.saveAndFlush(user);
  }

  @Transactional
  public void deleteAccount(String email, String password, String emailConfirmation) {
    deleteAccount(email, password, emailConfirmation, false);
  }

  private void requireActive(User user) {
    if (user.getAccountStatus() != AccountStatus.ACTIVE) {
      throw new InvalidCredentialsException("Your account is not active.");
    }
  }

  private void invalidatePersonalData(UUID userId, String email) {
    jdbcTemplate.update("DELETE FROM password_reset_token WHERE user_id = ?", userId);
    jdbcTemplate.update("DELETE FROM external_auth_identity WHERE user_id = ?", userId);
    jdbcTemplate.update("DELETE FROM push_subscriptions WHERE user_id = ?", userId);
    jdbcTemplate.update("DELETE FROM notification_preferences WHERE user_id = ?", userId);
    jdbcTemplate.update(
        """
                UPDATE notification_deliveries
                SET status = 'CANCELLED'
                WHERE notification_id IN (
                    SELECT id FROM notifications WHERE recipient_user_id = ?
                ) AND status = 'PENDING'
                """,
        userId);
    jdbcTemplate.update("DELETE FROM notifications WHERE recipient_user_id = ?", userId);
    invalidateAllSessionsForUser(email);
  }

  private void invalidateAllSessionsForUser(String email) {
    jdbcTemplate.update(
        """
                DELETE FROM spring_session_attributes
                WHERE session_primary_id IN (
                    SELECT primary_id FROM spring_session WHERE principal_name = ?
                )
                """,
        email);
    jdbcTemplate.update("DELETE FROM spring_session WHERE principal_name = ?", email);
  }
}
