package com.dirtyduty.app.service;

public interface EmailVerificationMailer {
  void sendVerificationCode(String email, String code);
}
