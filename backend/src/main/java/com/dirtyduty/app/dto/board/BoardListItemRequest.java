package com.dirtyduty.app.dto.board;

/** Add or edit an item: a name, and an optional note or quantity ("2%, 2L"). */
public record BoardListItemRequest(String name, String note) {}
