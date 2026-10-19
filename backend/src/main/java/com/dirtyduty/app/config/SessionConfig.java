package com.dirtyduty.app.config;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.config.SessionRepositoryCustomizer;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.session.jdbc.config.annotation.web.http.EnableJdbcHttpSession;

@Configuration
@EnableJdbcHttpSession
public class SessionConfig {

  @Bean
  SessionRepositoryCustomizer<JdbcIndexedSessionRepository> sessionTimeoutCustomizer(
      @Value("${spring.session.timeout:30d}") Duration sessionTimeout) {
    return sessionRepository -> sessionRepository.setDefaultMaxInactiveInterval(sessionTimeout);
  }
}
