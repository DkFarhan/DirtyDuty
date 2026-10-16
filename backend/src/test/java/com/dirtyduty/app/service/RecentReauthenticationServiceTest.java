package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;

class RecentReauthenticationServiceTest {
  private final RecentReauthenticationService service = new RecentReauthenticationService();

  @Test
  void consumesRecentProofExactlyOnce() {
    MockHttpServletRequest request = requestWithTime(Instant.now().toEpochMilli() - 60_000);

    assertThat(service.consume(request)).isTrue();
    assertThat(service.consume(request)).isFalse();
  }

  @Test
  void rejectsExpiredAndFutureProofs() {
    assertThat(service.consume(requestWithTime(Instant.now().toEpochMilli() - 6 * 60_000)))
        .isFalse();
    assertThat(service.consume(requestWithTime(Instant.now().toEpochMilli() + 60_000))).isFalse();
  }

  private MockHttpServletRequest requestWithTime(long timestamp) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpSession session = new MockHttpSession();
    session.setAttribute(GoogleIdentityService.REAUTHENTICATION_TIME, timestamp);
    request.setSession(session);
    return request;
  }
}
