package com.dirtyduty.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("ci")
class FreshDatabaseMigrationSmokeTest {

  @Autowired private ApplicationContext applicationContext;

  @Test
  void applicationStartsFromEmptyDatabase() {
    assertThat(applicationContext).isNotNull();
    assertThat(applicationContext.getEnvironment().getProperty("spring.datasource.url"))
        .isNotBlank();
  }
}
