package com.dirtyduty.app.notification;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.concurrent.ExecutionException;
import org.jose4j.lang.JoseException;

public interface WebPushClient {
    int send(
            String publicKey,
            String privateKey,
            String subject,
            String endpoint,
            String subscriptionPublicKey,
            String authSecret,
            byte[] payload)
            throws IOException, GeneralSecurityException, JoseException, ExecutionException, InterruptedException;
}
