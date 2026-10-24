package com.dirtyduty.app.exception;

public class EmailVerificationUnavailableException extends RuntimeException {
  public EmailVerificationUnavailableException() {
    super("This email address cannot be changed automatically. Please contact DirtyDuty support.");
  }
}
