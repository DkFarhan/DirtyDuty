package com.dirtyduty.app.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class PasswordResetEmailDeliveryListener {
  private static final Logger logger =
      LoggerFactory.getLogger(PasswordResetEmailDeliveryListener.class);

  private final PasswordResetMailer mailer;
  private final JdbcTemplate jdbc;

  public PasswordResetEmailDeliveryListener(PasswordResetMailer mailer, JdbcTemplate jdbc) {
    this.mailer = mailer;
    this.jdbc = jdbc;
  }

  @Async
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void send(PasswordResetEmailRequestedEvent event) {
    try {
      mailer.sendReset(event.email(), event.token(), event.expiresIn());
    } catch (RuntimeException exception) {
      jdbc.update(
          "UPDATE password_reset_token SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
          OffsetDateTime.now(ZoneOffset.UTC),
          event.tokenHash());
      logger.warn("Password reset email delivery failed; request response remains generic.");
    }
  }
}
