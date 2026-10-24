package com.dirtyduty.app.exception;

public class PasswordResetSamePasswordException extends RuntimeException {
  public PasswordResetSamePasswordException() {
    super("Your new password must be different from your current password.");
  }
}
