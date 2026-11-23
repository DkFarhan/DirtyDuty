package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.household.AwayPeriodRequest;
import com.dirtyduty.app.dto.household.AwayPreviewResponse;
import com.dirtyduty.app.dto.household.AwayStatusResponse;
import com.dirtyduty.app.service.AwayModeService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Away mode for a household member: the member themselves, or an owner or admin for anyone (E10).
 */
@RestController
@RequestMapping("/api/households/{householdId}/members/{userId}/away")
public class AwayModeController {
  private final AwayModeService awayModeService;

  public AwayModeController(AwayModeService awayModeService) {
    this.awayModeService = awayModeService;
  }

  @GetMapping
  public AwayStatusResponse status(
      @PathVariable UUID householdId, @PathVariable UUID userId, Authentication authentication) {
    return awayModeService.status(householdId, userId, authentication);
  }

  /** What these dates would do to the member's chores, without saving anything. */
  @PostMapping("/preview")
  public AwayPreviewResponse preview(
      @PathVariable UUID householdId,
      @PathVariable UUID userId,
      @RequestBody AwayPeriodRequest request,
      Authentication authentication) {
    return awayModeService.preview(householdId, userId, request, authentication);
  }

  @PostMapping
  public AwayStatusResponse set(
      @PathVariable UUID householdId,
      @PathVariable UUID userId,
      @RequestBody AwayPeriodRequest request,
      Authentication authentication) {
    return awayModeService.set(householdId, userId, request, authentication);
  }

  @PutMapping
  public AwayStatusResponse update(
      @PathVariable UUID householdId,
      @PathVariable UUID userId,
      @RequestBody AwayPeriodRequest request,
      Authentication authentication) {
    return awayModeService.update(householdId, userId, request, authentication);
  }

  /** "I'm back now". */
  @PostMapping("/end")
  public AwayStatusResponse end(
      @PathVariable UUID householdId, @PathVariable UUID userId, Authentication authentication) {
    return awayModeService.endNow(householdId, userId, authentication);
  }

  /** Removes away dates that haven't started. */
  @DeleteMapping
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(
      @PathVariable UUID householdId, @PathVariable UUID userId, Authentication authentication) {
    awayModeService.deleteUpcoming(householdId, userId, authentication);
  }
}
