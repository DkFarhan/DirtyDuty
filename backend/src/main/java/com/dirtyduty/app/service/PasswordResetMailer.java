package com.dirtyduty.app.service;

import java.time.Duration;

public interface PasswordResetMailer {
  void sendReset(String email, String token, Duration expiresIn);
}
