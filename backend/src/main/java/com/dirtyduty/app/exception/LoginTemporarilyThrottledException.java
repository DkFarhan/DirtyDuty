package com.dirtyduty.app.exception;

import org.springframework.security.core.AuthenticationException;

public class LoginTemporarilyThrottledException extends AuthenticationException {
  public LoginTemporarilyThrottledException(String message) {
    super(message);
  }
}
