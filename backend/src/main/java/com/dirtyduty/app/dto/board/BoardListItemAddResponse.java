package com.dirtyduty.app.dto.board;

/**
 * The item that was added, or the open item with the same name that was already on the list ({@code
 * existing}: nothing was added; the screen highlights it).
 */
public record BoardListItemAddResponse(BoardListItemResponse item, boolean existing) {}
