package com.dirtyduty.app.exception;

public class InvalidInvitationException extends RuntimeException {

  public InvalidInvitationException() {
    super("Invite code is invalid or no longer available.");
  }
}
