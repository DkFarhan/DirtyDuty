package com.dirtyduty.app.controller;

import com.dirtyduty.app.dto.notification.NotificationPreferencesRequest;
import com.dirtyduty.app.dto.notification.NotificationPreferencesResponse;
import com.dirtyduty.app.dto.notification.NotificationResponse;
import com.dirtyduty.app.dto.notification.HouseholdStyleRequest;
import com.dirtyduty.app.dto.notification.PushPublicKeyResponse;
import com.dirtyduty.app.dto.notification.PushSubscriptionRequest;
import com.dirtyduty.app.dto.notification.PushUnsubscribeRequest;
import com.dirtyduty.app.dto.notification.UnreadCountResponse;
import com.dirtyduty.app.notification.WebPushNotificationProvider;
import com.dirtyduty.app.service.PushSubscriptionService;
import com.dirtyduty.app.service.NotificationService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService notificationService;
    private final PushSubscriptionService pushSubscriptionService;
    private final WebPushNotificationProvider webPushProvider;

    public NotificationController(
            NotificationService notificationService,
            PushSubscriptionService pushSubscriptionService,
            WebPushNotificationProvider webPushProvider) {
        this.notificationService = notificationService;
        this.pushSubscriptionService = pushSubscriptionService;
        this.webPushProvider = webPushProvider;
    }

    @GetMapping
    public List<NotificationResponse> list(Authentication authentication) {
        return notificationService.list(authentication);
    }

    @GetMapping("/unread-count")
    public UnreadCountResponse unreadCount(Authentication authentication) {
        return new UnreadCountResponse(notificationService.unreadCount(authentication));
    }

    @PatchMapping("/{notificationId}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@PathVariable UUID notificationId, Authentication authentication) {
        notificationService.markRead(notificationId, authentication);
    }

    @PatchMapping("/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markAllRead(Authentication authentication) {
        notificationService.markAllRead(authentication);
    }

    @GetMapping("/preferences")
    public NotificationPreferencesResponse preferences(Authentication authentication) {
        return notificationService.preferences(authentication);
    }

    @PutMapping("/preferences")
    public NotificationPreferencesResponse updatePreferences(
            @Valid @RequestBody NotificationPreferencesRequest request, Authentication authentication) {
        return notificationService.updatePreferences(request, authentication);
    }

    @PutMapping("/households/{householdId}/style")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateHouseholdStyle(
            @PathVariable UUID householdId,
            @Valid @RequestBody HouseholdStyleRequest request,
            Authentication authentication) {
        notificationService.updateHouseholdStyle(householdId, request.style(), authentication);
    }

    @GetMapping("/push/public-key")
    public PushPublicKeyResponse pushPublicKey() {
        return new PushPublicKeyResponse(webPushProvider.publicKey(), webPushProvider.isConfigured());
    }

    @PutMapping("/push-subscriptions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void subscribe(
            @Valid @RequestBody PushSubscriptionRequest request,
            Authentication authentication) {
        pushSubscriptionService.subscribe(request, authentication);
    }

    @PostMapping("/push-subscriptions/unsubscribe")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unsubscribe(
            @Valid @RequestBody PushUnsubscribeRequest request,
            Authentication authentication) {
        pushSubscriptionService.unsubscribe(request.endpoint(), authentication);
    }
}
