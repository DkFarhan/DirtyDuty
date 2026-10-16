package com.dirtyduty.app.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.auth.password-reset.enabled", havingValue = "true")
public class SmtpPasswordResetMailer implements PasswordResetMailer {
  private final JavaMailSender mailSender;
  private final String fromAddress;
  private final String fromName;
  private final String appBaseUrl;

  public SmtpPasswordResetMailer(
      JavaMailSender mailSender,
      @Value("${MAIL_FROM_ADDRESS:}") String fromAddress,
      @Value("${MAIL_FROM_NAME:DirtyDuty}") String fromName,
      @Value("${app.base-url}") String appBaseUrl) {
    this.mailSender = mailSender;
    this.fromAddress = fromAddress;
    this.fromName = fromName;
    this.appBaseUrl = appBaseUrl.replaceAll("/+$", "");
  }

  @Override
  public void sendReset(String email, String token, Duration expiresIn) {
    try {
      InternetAddress from =
          new InternetAddress(fromAddress, fromName, StandardCharsets.UTF_8.name());
      from.validate();
      String resetUrl = appBaseUrl + "/reset-password#token=" + token;
      long minutes = Math.max(1, expiresIn.toMinutes());
      MimeMessage message = mailSender.createMimeMessage();
      MimeMessageHelper helper =
          new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
      helper.setFrom(from);
      helper.setTo(email);
      helper.setSubject("Reset your DirtyDuty password");
      helper.setText(
          "We received a request to reset your DirtyDuty password. Open this link to choose a new password: "
              + resetUrl
              + "\n\nThis link expires in "
              + minutes
              + " minutes. If you didn't request this, you can ignore this email.",
          """
          <!doctype html><html><body style="font-family:Arial,sans-serif;color:#1e293b">
          <h1>DirtyDuty</h1><p>We received a request to reset your password.</p>
          <p><a href="%s" style="background:#0d9488;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p>
          <p>This link expires in %d minutes.</p>
          <p>If you didn't request this, you can ignore this email.</p>
          </body></html>
          """
              .formatted(escapeHtml(resetUrl), minutes));
      mailSender.send(message);
    } catch (MessagingException | UnsupportedEncodingException exception) {
      throw new IllegalStateException("Password reset email delivery failed.", exception);
    }
  }

  private String escapeHtml(String value) {
    return value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }
}
