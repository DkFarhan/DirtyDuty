package com.dirtyduty.app.service;

import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
    name = "app.auth.password-reset.enabled",
    havingValue = "false",
    matchIfMissing = true)
public class DisabledPasswordResetMailer implements PasswordResetMailer {
  @Override
  public void sendReset(String email, String token, Duration expiresIn) {
    throw new IllegalStateException("Password reset email delivery is disabled.");
  }
}
