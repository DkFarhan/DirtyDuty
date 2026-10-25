package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

@ExtendWith(MockitoExtension.class)
class GoogleIdentityServiceTest {
  @Mock private JdbcTemplate jdbc;

  @Mock private UserRepository userRepository;

  @Test
  void newlyCreatedGoogleAccountRequiresDisplayNamePersonalization() {
    when(jdbc.query(
            anyString(), ArgumentMatchers.<ResultSetExtractor<UUID>>any(), eq("google-subject")))
        .thenReturn(null);
    when(userRepository.findByEmailIgnoreCaseForUpdate("new-google@example.com"))
        .thenReturn(Optional.empty());
    when(userRepository.saveAndFlush(any(User.class)))
        .thenAnswer(
            invocation -> {
              User user = invocation.getArgument(0);
              user.setId(UUID.randomUUID());
              return user;
            });

    GoogleIdentityService service = new GoogleIdentityService(userRepository, jdbc);
    GoogleIdentityService.Result result =
        service.authenticateVerifiedIdentity(
            "google-subject", "new-google@example.com", "Google User", true);

    assertThat(result.type()).isEqualTo(GoogleIdentityService.ResultType.AUTHENTICATED);
    assertThat(result.user().isDisplayNamePersonalizationCompleted()).isFalse();
  }
}
