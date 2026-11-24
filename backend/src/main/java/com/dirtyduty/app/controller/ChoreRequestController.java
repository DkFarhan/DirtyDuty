package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.chore.ChoreRequestCreate;
import com.dirtyduty.app.dto.chore.ChoreRequestListResponse;
import com.dirtyduty.app.dto.chore.ChoreRequestResponse;
import com.dirtyduty.app.dto.chore.RequestCandidatesResponse;
import com.dirtyduty.app.service.ChoreRequestService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Hand-off and swap requests between members (E11). */
@RestController
@RequestMapping("/api/households/{householdId}")
public class ChoreRequestController {
  private final ChoreRequestService requests;

  public ChoreRequestController(ChoreRequestService requests) {
    this.requests = requests;
  }

  /** Open requests the viewer can answer, and the ones they made. */
  @GetMapping("/requests")
  public ChoreRequestListResponse list(
      @PathVariable UUID householdId, Authentication authentication) {
    return requests.list(householdId, authentication);
  }

  /** Who the viewer could ask about one of their chores, and what they could swap it for. */
  @GetMapping("/assignments/{assignmentId}/request-candidates")
  public RequestCandidatesResponse candidates(
      @PathVariable UUID householdId,
      @PathVariable UUID assignmentId,
      Authentication authentication) {
    return requests.candidates(householdId, assignmentId, authentication);
  }

  @PostMapping("/requests")
  @ResponseStatus(HttpStatus.CREATED)
  public ChoreRequestResponse create(
      @PathVariable UUID householdId,
      @RequestBody ChoreRequestCreate body,
      Authentication authentication) {
    return requests.create(householdId, body, authentication);
  }

  @PostMapping("/requests/{requestId}/accept")
  public ChoreRequestResponse accept(
      @PathVariable UUID householdId, @PathVariable UUID requestId, Authentication authentication) {
    return requests.accept(householdId, requestId, authentication);
  }

  @PostMapping("/requests/{requestId}/decline")
  public ChoreRequestResponse decline(
      @PathVariable UUID householdId, @PathVariable UUID requestId, Authentication authentication) {
    return requests.decline(householdId, requestId, authentication);
  }

  @PostMapping("/requests/{requestId}/cancel")
  public ChoreRequestResponse cancel(
      @PathVariable UUID householdId, @PathVariable UUID requestId, Authentication authentication) {
    return requests.cancel(householdId, requestId, authentication);
  }
}
