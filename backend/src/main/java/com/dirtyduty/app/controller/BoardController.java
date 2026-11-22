package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.board.BoardListItemAddResponse;
import com.dirtyduty.app.dto.board.BoardListItemRequest;
import com.dirtyduty.app.dto.board.BoardListItemResponse;
import com.dirtyduty.app.dto.board.BoardListItemsResponse;
import com.dirtyduty.app.dto.board.BoardListRequest;
import com.dirtyduty.app.dto.board.BoardListResponse;
import com.dirtyduty.app.dto.board.BoardListsResponse;
import com.dirtyduty.app.dto.board.BoardPostRequest;
import com.dirtyduty.app.dto.board.BoardPostResponse;
import com.dirtyduty.app.dto.board.BoardResponse;
import com.dirtyduty.app.dto.board.BoardSeenRequest;
import com.dirtyduty.app.dto.board.BoardUnseenResponse;
import com.dirtyduty.app.service.BoardListService;
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

/** The Household Board: posts and shared lists every active member sees. Non-members get 404. */
@RestController
@RequestMapping("/api/households/{householdId}/board")
public class BoardController {
  private final BoardPostService boardPostService;
  private final BoardListService boardListService;

  public BoardController(BoardPostService boardPostService, BoardListService boardListService) {
    this.boardPostService = boardPostService;
    this.boardListService = boardListService;
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

  // ---- Lists -----------------------------------------------------------------------------------

  @GetMapping("/lists")
  public BoardListsResponse lists(@PathVariable UUID householdId, Authentication authentication) {
    return boardListService.lists(householdId, authentication);
  }

  @PostMapping("/lists")
  @ResponseStatus(HttpStatus.CREATED)
  public BoardListResponse createList(
      @PathVariable UUID householdId,
      @RequestBody BoardListRequest request,
      Authentication authentication) {
    return boardListService.createList(householdId, request, authentication);
  }

  @PutMapping("/lists/{listId}")
  public BoardListResponse renameList(
      @PathVariable UUID householdId,
      @PathVariable UUID listId,
      @RequestBody BoardListRequest request,
      Authentication authentication) {
    return boardListService.renameList(householdId, listId, request, authentication);
  }

  @PostMapping("/lists/{listId}/archive")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void archiveList(
      @PathVariable UUID householdId, @PathVariable UUID listId, Authentication authentication) {
    boardListService.archiveList(householdId, listId, authentication);
  }

  @GetMapping("/lists/{listId}/items")
  public BoardListItemsResponse items(
      @PathVariable UUID householdId, @PathVariable UUID listId, Authentication authentication) {
    return boardListService.items(householdId, listId, authentication);
  }

  /** Adds an item, or answers with the open item of the same name ({@code existing}). */
  @PostMapping("/lists/{listId}/items")
  public BoardListItemAddResponse addItem(
      @PathVariable UUID householdId,
      @PathVariable UUID listId,
      @RequestBody BoardListItemRequest request,
      Authentication authentication) {
    return boardListService.addItem(householdId, listId, request, authentication);
  }

  /** Names this household added before, most recent first (suggestions). */
  @GetMapping("/list-items/recent")
  public List<String> recentItemNames(
      @PathVariable UUID householdId, Authentication authentication) {
    return boardListService.recentNames(householdId, authentication);
  }

  @PutMapping("/list-items/{itemId}")
  public BoardListItemResponse updateItem(
      @PathVariable UUID householdId,
      @PathVariable UUID itemId,
      @RequestBody BoardListItemRequest request,
      Authentication authentication) {
    return boardListService.updateItem(householdId, itemId, request, authentication);
  }

  @DeleteMapping("/list-items/{itemId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteItem(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    boardListService.deleteItem(householdId, itemId, authentication);
  }

  @PostMapping("/list-items/{itemId}/claim")
  public BoardListItemResponse claimItem(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    return boardListService.claim(householdId, itemId, authentication);
  }

  @PostMapping("/list-items/{itemId}/release")
  public BoardListItemResponse releaseItem(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    return boardListService.release(householdId, itemId, authentication);
  }

  @PostMapping("/list-items/{itemId}/today")
  public BoardListItemResponse neededToday(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    return boardListService.neededToday(householdId, itemId, true, authentication);
  }

  @DeleteMapping("/list-items/{itemId}/today")
  public BoardListItemResponse notNeededToday(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    return boardListService.neededToday(householdId, itemId, false, authentication);
  }

  @PostMapping("/list-items/{itemId}/buy")
  public BoardListItemResponse buyItem(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    return boardListService.buy(householdId, itemId, authentication);
  }

  @PostMapping("/list-items/{itemId}/unbuy")
  public BoardListItemResponse unbuyItem(
      @PathVariable UUID householdId, @PathVariable UUID itemId, Authentication authentication) {
    return boardListService.unbuy(householdId, itemId, authentication);
  }
}
