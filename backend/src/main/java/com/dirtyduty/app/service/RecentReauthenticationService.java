package com.dirtyduty.app.service;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.springframework.stereotype.Service;

@Service
public class RecentReauthenticationService {
  private static final long MAX_AGE_MILLIS = 5 * 60 * 1000;

  public boolean consume(HttpServletRequest request) {
    var session = request.getSession(false);
    if (session == null) return false;
    Object value = session.getAttribute(GoogleIdentityService.REAUTHENTICATION_TIME);
    session.removeAttribute(GoogleIdentityService.REAUTHENTICATION_TIME);
    if (!(value instanceof Long timestamp)) return false;
    long age = Instant.now().toEpochMilli() - timestamp;
    return age >= 0 && age <= MAX_AGE_MILLIS;
  }
}
