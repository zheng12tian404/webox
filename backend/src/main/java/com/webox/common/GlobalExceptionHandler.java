package com.webox.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> api(ApiException e) {
        return ResponseEntity.status(e.getStatus())
                .body(Api.envelope(e.getCode(), e.getMessage(), e.getData()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException e) {
        String field = e.getBindingResult().getFieldError() == null ? "" : e.getBindingResult().getFieldError().getField();
        String code = switch (field) {
            case "email" -> "VALIDATION_EMAIL_FORMAT";
            case "password" -> "VALIDATION_PASSWORD_POLICY";
            case "address" -> "VALIDATION_ADDRESS_LENGTH";
            case "search" -> "VALIDATION_SEARCH_LENGTH";
            case "reason" -> "VALIDATION_REASON_REQUIRED";
            case "qty" -> "VALIDATION_QUANTITY";
            default -> "VALIDATION_INVALID";
        };
        String msg = e.getBindingResult().getFieldError() == null ? "Validation failed"
                : e.getBindingResult().getFieldError().getDefaultMessage();
        return ResponseEntity.badRequest().body(Api.envelope(code, msg, null));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class})
    public ResponseEntity<Map<String, Object>> badRequest(Exception e) {
        return ResponseEntity.badRequest().body(Api.envelope("VALIDATION_INVALID", "Invalid request", null));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> tooLarge(MaxUploadSizeExceededException e) {
        return ResponseEntity.badRequest().body(Api.envelope("VALIDATION_IMAGE", "Image must be at most 5MB", null));
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String, Object>> data(DataAccessException e) {
        log.error("Database error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Api.envelope("INTERNAL", "Internal server error", null));
    }

    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(Exception e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Api.envelope("NOT_FOUND", "Resource not found", null));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> other(Exception e) {
        log.error("Unhandled error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Api.envelope("INTERNAL", "Internal server error", null));
    }
}