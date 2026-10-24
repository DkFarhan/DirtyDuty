package com.dirtyduty.app.exception;

public class EmailVerificationInvalidCodeException extends RuntimeException {
  public EmailVerificationInvalidCodeException() {
    super("The verification code is invalid or expired.");
  }
}
