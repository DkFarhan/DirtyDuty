package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.board.BoardPostRequest;
import com.dirtyduty.app.dto.board.BoardPostResponse;
import com.dirtyduty.app.dto.board.BoardResponse;
import com.dirtyduty.app.dto.board.BoardSeenRequest;
import com.dirtyduty.app.dto.board.BoardUnseenResponse;
import com.dirtyduty.app.service.BoardPostService;
import java.util.List;
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

/** The Household Board: posts every active member sees. Non-members get 404. */
@RestController
@RequestMapping("/api/households/{householdId}/board")
public class BoardController {
  private final BoardPostService boardPostService;

  public BoardController(BoardPostService boardPostService) {
    this.boardPostService = boardPostService;
  }

  @GetMapping
  public BoardResponse board(@PathVariable UUID householdId, Authentication authentication) {
    return boardPostService.board(householdId, authentication);
  }

  @GetMapping("/past")
  public List<BoardPostResponse> past(
      @PathVariable UUID householdId, Authentication authentication) {
    return boardPostService.past(householdId, authentication);
  }

  @GetMapping("/unseen")
  public BoardUnseenResponse unseen(@PathVariable UUID householdId, Authentication authentication) {
    return new BoardUnseenResponse(boardPostService.unseenCount(householdId, authentication));
  }

  @PostMapping("/posts")
  @ResponseStatus(HttpStatus.CREATED)
  public BoardPostResponse create(
      @PathVariable UUID householdId,
      @RequestBody BoardPostRequest request,
      Authentication authentication) {
    return boardPostService.create(householdId, request, authentication);
  }

  @GetMapping("/posts/{postId}")
  public BoardPostResponse get(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    return boardPostService.get(householdId, postId, authentication);
  }

  @PutMapping("/posts/{postId}")
  public BoardPostResponse update(
      @PathVariable UUID householdId,
      @PathVariable UUID postId,
      @RequestBody BoardPostRequest request,
      Authentication authentication) {
    return boardPostService.update(householdId, postId, request, authentication);
  }

  @DeleteMapping("/posts/{postId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    boardPostService.delete(householdId, postId, authentication);
  }

  /** Seen, in one batch for several posts. */
  @PostMapping("/seen")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void seen(
      @PathVariable UUID householdId,
      @RequestBody BoardSeenRequest request,
      Authentication authentication) {
    boardPostService.seen(householdId, request == null ? null : request.postIds(), authentication);
  }

  @PostMapping("/posts/{postId}/got-it")
  public BoardPostResponse gotIt(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    return boardPostService.gotIt(householdId, postId, authentication);
  }

  @PostMapping("/posts/{postId}/handle")
  public BoardPostResponse handle(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    return boardPostService.handle(householdId, postId, authentication);
  }

  @PostMapping("/posts/{postId}/release")
  public BoardPostResponse release(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    return boardPostService.release(householdId, postId, authentication);
  }

  @PostMapping("/posts/{postId}/fix")
  public BoardPostResponse fix(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    return boardPostService.fix(householdId, postId, authentication);
  }

  @PostMapping("/posts/{postId}/remind")
  public BoardPostResponse remind(
      @PathVariable UUID householdId, @PathVariable UUID postId, Authentication authentication) {
    return boardPostService.remind(householdId, postId, authentication);
  }
}
