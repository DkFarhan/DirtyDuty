package com.dirtyduty.app.exception;

public class EmailVerificationRateLimitException extends RuntimeException {
  public EmailVerificationRateLimitException() {
    super("Please wait before trying again.");
  }
}
