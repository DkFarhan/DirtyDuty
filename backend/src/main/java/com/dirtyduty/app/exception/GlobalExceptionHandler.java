package com.dirtyduty.app.exception;

import com.dirtyduty.app.dto.ApiErrorResponse;
import com.dirtyduty.app.dto.auth.AccountDeletionConflictResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(AccountDeletionConflictException.class)
  public ResponseEntity<AccountDeletionConflictResponse> handleAccountDeletionConflict(
      AccountDeletionConflictException ex, HttpServletRequest request) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(
            new AccountDeletionConflictResponse(
                HttpStatus.CONFLICT.value(),
                "Conflict",
                ex.getMessage(),
                request.getRequestURI(),
                OffsetDateTime.now(),
                ex.getOwnedHouseholds()));
  }

  @ExceptionHandler(ResourceNotFoundException.class)
  public ResponseEntity<ApiErrorResponse> handleResourceNotFound(
      ResourceNotFoundException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.NOT_FOUND, "Not Found", ex.getMessage(), request.getRequestURI());
  }

  @ExceptionHandler(DuplicateResourceException.class)
  public ResponseEntity<ApiErrorResponse> handleDuplicateResource(
      DuplicateResourceException ex, HttpServletRequest request) {
    return buildResponse(HttpStatus.CONFLICT, "Conflict", ex.getMessage(), request.getRequestURI());
  }

  @ExceptionHandler(InvalidHouseholdException.class)
  public ResponseEntity<ApiErrorResponse> handleInvalidHousehold(
      InvalidHouseholdException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.BAD_REQUEST, "Bad Request", ex.getMessage(), request.getRequestURI());
  }

  @ExceptionHandler(InvalidInvitationException.class)
  public ResponseEntity<ApiErrorResponse> handleInvalidInvitation(HttpServletRequest request) {
    return buildResponse(
        HttpStatus.BAD_REQUEST,
        "Bad Request",
        "Invite code is invalid or no longer available.",
        request.getRequestURI());
  }

  @ExceptionHandler(HouseholdAccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> handleHouseholdAccessDenied(
      HouseholdAccessDeniedException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.FORBIDDEN, "Forbidden", ex.getMessage(), request.getRequestURI());
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<ApiErrorResponse> handleDataIntegrityViolation(
      DataIntegrityViolationException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.CONFLICT,
        "Conflict",
        "The request conflicts with existing data.",
        request.getRequestURI());
  }

  @ExceptionHandler(InvalidCredentialsException.class)
  public ResponseEntity<ApiErrorResponse> handleInvalidCredentials(
      InvalidCredentialsException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.BAD_REQUEST, "Bad Request", ex.getMessage(), request.getRequestURI());
  }

  @ExceptionHandler(AuthenticationException.class)
  public ResponseEntity<ApiErrorResponse> handleAuthenticationFailure(
      AuthenticationException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.UNAUTHORIZED,
        "Unauthorized",
        "Invalid email or password",
        request.getRequestURI());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiErrorResponse> handleMethodArgumentNotValid(
      MethodArgumentNotValidException ex, HttpServletRequest request) {
    Map<String, String> errors = new LinkedHashMap<>();
    for (FieldError fieldError : ex.getBindingResult().getFieldErrors()) {
      errors.put(fieldError.getField(), fieldError.getDefaultMessage());
    }

    String message = errors.isEmpty() ? "Validation failed." : errors.toString();
    return buildResponse(HttpStatus.BAD_REQUEST, "Bad Request", message, request.getRequestURI());
  }

  @ExceptionHandler(ConstraintViolationException.class)
  public ResponseEntity<ApiErrorResponse> handleConstraintViolation(
      ConstraintViolationException ex, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.BAD_REQUEST,
        "Bad Request",
        "Request validation failed.",
        request.getRequestURI());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> handleGeneralException(
      Exception ex, HttpServletRequest request) {
    log.error("Unhandled exception for {} {}", request.getMethod(), request.getRequestURI(), ex);
    return buildResponse(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "Internal Server Error",
        "An unexpected error occurred.",
        request.getRequestURI());
  }

  private ResponseEntity<ApiErrorResponse> buildResponse(
      HttpStatus status, String error, String message, String path) {
    ApiErrorResponse body =
        new ApiErrorResponse(status.value(), error, message, path, OffsetDateTime.now());

    return ResponseEntity.status(status).body(body);
  }
}
