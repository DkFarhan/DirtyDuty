package com.dirtyduty.app.notification;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.Security;
import java.util.concurrent.ExecutionException;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import org.apache.http.HttpResponse;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.jose4j.lang.JoseException;
import org.springframework.stereotype.Component;

@Component
public class DefaultWebPushClient implements WebPushClient {
  public DefaultWebPushClient() {
    Security.addProvider(new BouncyCastleProvider());
  }

  @Override
  public int send(
      String publicKey,
      String privateKey,
      String subject,
      String endpoint,
      String subscriptionPublicKey,
      String authSecret,
      byte[] payload)
      throws IOException,
          GeneralSecurityException,
          JoseException,
          ExecutionException,
          InterruptedException {
    FcmCompatiblePushService pushService;
    try {
      pushService = new FcmCompatiblePushService(publicKey, privateKey, subject);
    } catch (GeneralSecurityException exception) {
      throw new IllegalStateException("Web Push VAPID keys are invalid.", exception);
    }
    HttpResponse response =
        pushService.send(
            new Notification(endpoint, subscriptionPublicKey, authSecret, payload, 3600),
            Encoding.AES128GCM);
    return response.getStatusLine().getStatusCode();
  }
}
