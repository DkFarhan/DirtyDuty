package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.chore.AssignmentResponse;
import com.dirtyduty.app.dto.chore.ChoreCategoryResponse;
import com.dirtyduty.app.dto.chore.ChoreManagementOptionsResponse;
import com.dirtyduty.app.dto.chore.ChoreRequest;
import com.dirtyduty.app.dto.chore.ChoreResponse;
import com.dirtyduty.app.dto.chore.DashboardResponse;
import com.dirtyduty.app.dto.chore.HouseholdMemberStatsResponse;
import com.dirtyduty.app.service.ChoreService;
import com.dirtyduty.app.service.OccurrenceService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/households/{householdId}")
public class ChoreController {

  private final ChoreService choreService;
  private final OccurrenceService occurrenceService;

  public ChoreController(ChoreService choreService, OccurrenceService occurrenceService) {
    this.choreService = choreService;
    this.occurrenceService = occurrenceService;
  }

  @PostMapping("/assignments/{assignmentId}/complete")
  public AssignmentResponse completeAssignment(
      @PathVariable UUID householdId,
      @PathVariable UUID assignmentId,
      Authentication authentication) {
    return occurrenceService.complete(householdId, assignmentId, authentication);
  }

  @GetMapping("/my-chores")
  public List<AssignmentResponse> myChores(
      @PathVariable UUID householdId,
      @RequestParam(defaultValue = "UPCOMING") String status,
      Authentication authentication) {
    return occurrenceService.myChores(householdId, status, authentication);
  }

  @GetMapping("/dashboard")
  public DashboardResponse dashboard(
      @PathVariable UUID householdId, Authentication authentication) {
    return occurrenceService.dashboard(householdId, authentication);
  }

  @GetMapping("/members")
  public List<HouseholdMemberStatsResponse> members(
      @PathVariable UUID householdId, Authentication authentication) {
    return occurrenceService.members(householdId, authentication);
  }

  @GetMapping("/chore-categories")
  public List<ChoreCategoryResponse> listCategories(
      @PathVariable UUID householdId, Authentication authentication) {
    return choreService.listCategories(householdId, authentication);
  }

  @GetMapping("/chore-management-options")
  public ChoreManagementOptionsResponse managementOptions(
      @PathVariable UUID householdId, Authentication authentication) {
    return choreService.managementOptions(householdId, authentication);
  }

  @GetMapping("/chores")
  public List<ChoreResponse> listChores(
      @PathVariable UUID householdId,
      @RequestParam(defaultValue = "false") boolean includeArchived,
      Authentication authentication) {
    return choreService.listChores(householdId, includeArchived, authentication);
  }

  @PostMapping("/chores")
  public ResponseEntity<ChoreResponse> createChore(
      @PathVariable UUID householdId,
      @Valid @RequestBody ChoreRequest request,
      Authentication authentication) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(choreService.createChore(householdId, request, authentication));
  }

  @GetMapping("/chores/{choreId}")
  public ChoreResponse getChore(
      @PathVariable UUID householdId, @PathVariable UUID choreId, Authentication authentication) {
    return choreService.getChore(householdId, choreId, authentication);
  }

  @PutMapping("/chores/{choreId}")
  public ChoreResponse updateChore(
      @PathVariable UUID householdId,
      @PathVariable UUID choreId,
      @Valid @RequestBody ChoreRequest request,
      Authentication authentication) {
    return choreService.updateChore(householdId, choreId, request, authentication);
  }

  @PostMapping("/chores/{choreId}/pause")
  public ChoreResponse pauseChore(
      @PathVariable UUID householdId, @PathVariable UUID choreId, Authentication authentication) {
    return choreService.pauseChore(householdId, choreId, authentication);
  }

  @PostMapping("/chores/{choreId}/activate")
  public ChoreResponse activateChore(
      @PathVariable UUID householdId, @PathVariable UUID choreId, Authentication authentication) {
    return choreService.activateChore(householdId, choreId, authentication);
  }

  @PostMapping("/chores/{choreId}/archive")
  public ChoreResponse archiveChore(
      @PathVariable UUID householdId, @PathVariable UUID choreId, Authentication authentication) {
    return choreService.archiveChore(householdId, choreId, authentication);
  }
}
