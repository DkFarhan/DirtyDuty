package com.dirtyduty.app.service;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.entity.enums.AccountStatus;
import com.dirtyduty.app.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GoogleIdentityService {
  public static final String PENDING_SUBJECT = "dirtyduty.google.pending.subject";
  public static final String PENDING_EMAIL = "dirtyduty.google.pending.email";
  public static final String PENDING_CREATED = "dirtyduty.google.pending.created";
  public static final String REAUTHENTICATION_TIME = "dirtyduty.auth.reauthenticated.at";
  public static final String REAUTH_RETURN_SCREEN = "dirtyduty.google.reauth.returnScreen";
  public static final String OAUTH_INTENT = "dirtyduty.oauth.intent";

  public enum ResultType {
    AUTHENTICATED,
    LINK_REQUIRED
  }

  public record Result(ResultType type, User user) {}

  private final UserRepository userRepository;
  private final JdbcTemplate jdbc;

  public GoogleIdentityService(UserRepository userRepository, JdbcTemplate jdbc) {
    this.userRepository = userRepository;
    this.jdbc = jdbc;
  }

  @Transactional
  public Result authenticateVerifiedIdentity(
      String subject, String submittedEmail, String displayName, boolean emailVerified) {
    if (!emailVerified
        || subject == null
        || subject.isBlank()
        || subject.length() > 255
        || submittedEmail == null
        || submittedEmail.isBlank()) {
      throw new BadCredentialsException("Google authentication could not be completed.");
    }
    String email = submittedEmail.trim().toLowerCase(Locale.ROOT);

    UUID linkedId =
        jdbc.query(
            "SELECT user_id FROM external_auth_identity WHERE provider='GOOGLE' AND provider_subject=?",
            resultSet -> resultSet.next() ? UUID.fromString(resultSet.getString(1)) : null,
            subject);
    if (linkedId != null) {
      User linked =
          userRepository
              .findByIdForUpdate(linkedId)
              .filter(user -> user.getAccountStatus() == AccountStatus.ACTIVE)
              .orElseThrow(
                  () ->
                      new BadCredentialsException("Google authentication could not be completed."));
      jdbc.update(
          "UPDATE external_auth_identity SET last_login_at=NOW() WHERE provider='GOOGLE' AND provider_subject=?",
          subject);
      return new Result(ResultType.AUTHENTICATED, linked);
    }

    User existing = userRepository.findByEmailIgnoreCaseForUpdate(email).orElse(null);
    if (existing != null) {
      if (existing.getAccountStatus() != AccountStatus.ACTIVE) {
        throw new BadCredentialsException("Google authentication could not be completed.");
      }
      return new Result(ResultType.LINK_REQUIRED, existing);
    }

    User user = new User();
    String normalizedName =
        displayName == null || displayName.isBlank()
            ? email.substring(0, email.indexOf('@'))
            : displayName.trim();
    if (normalizedName.length() < 2) normalizedName = normalizedName + " User";
    user.setDisplayName(normalizedName.substring(0, Math.min(100, normalizedName.length())));
    user.setEmail(email);
    user.setPasswordHash(null);
    user.setTimezone("UTC");
    user.setAccountStatus(AccountStatus.ACTIVE);
    user.setEmailVerifiedAt(OffsetDateTime.now(ZoneOffset.UTC));
    user.setDisplayNamePersonalizationCompleted(false);
    User saved = userRepository.saveAndFlush(user);
    jdbc.update(
        """
        INSERT INTO external_auth_identity(
            user_id, provider, provider_subject, provider_email_at_link_time, last_login_at
        ) VALUES (?, 'GOOGLE', ?, ?, NOW())
        """,
        saved.getId(),
        subject,
        email);
    return new Result(ResultType.AUTHENTICATED, saved);
  }

  @Transactional
  public User linkToPasswordAccount(String subject, String email) {
    User user =
        userRepository
            .findByEmailIgnoreCaseForUpdate(email)
            .filter(found -> found.getAccountStatus() == AccountStatus.ACTIVE)
            .orElseThrow(
                () ->
                    new BadCredentialsException("Google account linking could not be completed."));
    if (user.getPasswordHash() == null) {
      throw new BadCredentialsException("Google account linking could not be completed.");
    }
    jdbc.update(
        """
        INSERT INTO external_auth_identity(
            user_id, provider, provider_subject, provider_email_at_link_time, last_login_at
        ) VALUES (?, 'GOOGLE', ?, ?, NOW())
        """,
        user.getId(),
        subject,
        email);
    if (user.getEmailVerifiedAt() == null) {
      user.setEmailVerifiedAt(OffsetDateTime.now(ZoneOffset.UTC));
      userRepository.saveAndFlush(user);
    }
    return user;
  }

  public boolean hasGoogleIdentity(UUID userId) {
    Integer count =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM external_auth_identity WHERE user_id=? AND provider='GOOGLE'",
            Integer.class,
            userId);
    return count != null && count > 0;
  }
}
