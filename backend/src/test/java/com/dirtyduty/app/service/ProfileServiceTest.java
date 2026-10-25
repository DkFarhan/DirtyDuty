package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

@ExtendWith(MockitoExtension.class)
class ProfileServiceTest {
  @Mock private JdbcTemplate jdbc;

  @Mock private UserRepository userRepository;

  @InjectMocks private ProfileService profileService;

  @Test
  void skippingDisplayNamePersonalizationPersistsCompletionWithoutChangingTheName() {
    User user = new User();
    user.setEmail("new-user@example.com");
    user.setDisplayName("Original Name");
    user.setDisplayNamePersonalizationCompleted(false);
    when(userRepository.findByEmailIgnoreCase(user.getEmail())).thenReturn(Optional.of(user));
    Authentication authentication =
        new UsernamePasswordAuthenticationToken(user.getEmail(), null, List.of());

    profileService.completeDisplayNamePersonalization(authentication);

    assertThat(user.getDisplayName()).isEqualTo("Original Name");
    assertThat(user.isDisplayNamePersonalizationCompleted()).isTrue();
    verify(userRepository).saveAndFlush(user);
  }
}
