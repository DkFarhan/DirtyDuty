package com.dirtyduty.app.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
    name = "app.auth.email-verification.delivery-enabled",
    havingValue = "false",
    matchIfMissing = true)
public class DisabledEmailVerificationMailer implements EmailVerificationMailer {
  @Override
  public void sendVerificationCode(String email, String code) {
    throw new IllegalStateException("Email verification delivery is not configured.");
  }
}
