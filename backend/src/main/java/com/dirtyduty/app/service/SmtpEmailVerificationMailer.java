package com.dirtyduty.app.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.auth.email-verification.delivery-enabled", havingValue = "true")
public class SmtpEmailVerificationMailer implements EmailVerificationMailer {
  private final JavaMailSender mailSender;
  private final String fromAddress;
  private final String fromName;

  public SmtpEmailVerificationMailer(
      JavaMailSender mailSender,
      @Value("${MAIL_FROM_ADDRESS:}") String fromAddress,
      @Value("${MAIL_FROM_NAME:DirtyDuty}") String fromName) {
    this.mailSender = mailSender;
    this.fromAddress = fromAddress;
    this.fromName = fromName;
  }

  @Override
  public void sendVerificationCode(String email, String code) {
    try {
      InternetAddress from =
          new InternetAddress(fromAddress, fromName, StandardCharsets.UTF_8.name());
      from.validate();
      MimeMessage message = mailSender.createMimeMessage();
      MimeMessageHelper helper =
          new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
      helper.setFrom(from);
      helper.setTo(email);
      helper.setSubject("Verify your DirtyDuty email");
      helper.setText(
          "Your DirtyDuty verification code is "
              + code
              + ". It expires in 10 minutes. If you didn't request this, you can ignore this email.",
          """
          <!doctype html><html><body style="font-family:Arial,sans-serif;color:#1e293b">
          <h1 style="color:#0d9488">DirtyDuty</h1>
          <p>Use this code to verify your email address:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px">%s</p>
          <p>This code expires in 10 minutes.</p>
          <p>If you didn't request this, you can ignore this email.</p>
          </body></html>
          """
              .formatted(code));
      mailSender.send(message);
    } catch (MessagingException | UnsupportedEncodingException exception) {
      throw new IllegalStateException("Email verification delivery failed.", exception);
    }
  }
}
