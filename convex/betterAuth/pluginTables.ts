// The tables Better Auth's plugins add, copied from createAuthOptions in ../auth.ts.
// adapter.ts needs only these, and importing ../auth.ts there would load all of Better
// Auth on every database call it makes. pluginTables.test.ts fails when this copy no
// longer matches; run it with UPDATE_PLUGIN_TABLES=1 to rewrite this file.
export const pluginTables = [
  {
    "id": "organization",
    "schema": {
      "organization": {
        "fields": {
          "name": {
            "type": "string",
            "required": true,
            "sortable": true
          },
          "slug": {
            "type": "string",
            "required": true,
            "unique": true,
            "sortable": true,
            "index": true
          },
          "logo": {
            "type": "string",
            "required": false
          },
          "createdAt": {
            "type": "date",
            "required": true
          },
          "metadata": {
            "type": "string",
            "required": false
          }
        }
      },
      "member": {
        "fields": {
          "organizationId": {
            "type": "string",
            "required": true,
            "references": {
              "model": "organization",
              "field": "id"
            },
            "index": true
          },
          "userId": {
            "type": "string",
            "required": true,
            "references": {
              "model": "user",
              "field": "id"
            },
            "index": true
          },
          "role": {
            "type": "string",
            "required": true,
            "sortable": true,
            "defaultValue": "member"
          },
          "createdAt": {
            "type": "date",
            "required": true
          }
        }
      },
      "invitation": {
        "fields": {
          "organizationId": {
            "type": "string",
            "required": true,
            "references": {
              "model": "organization",
              "field": "id"
            },
            "index": true
          },
          "email": {
            "type": "string",
            "required": true,
            "sortable": true,
            "index": true
          },
          "role": {
            "type": "string",
            "required": false,
            "sortable": true
          },
          "status": {
            "type": "string",
            "required": true,
            "sortable": true,
            "defaultValue": "pending"
          },
          "expiresAt": {
            "type": "date",
            "required": true
          },
          "createdAt": {
            "type": "date",
            "required": true
          },
          "inviterId": {
            "type": "string",
            "references": {
              "model": "user",
              "field": "id"
            },
            "required": true
          }
        }
      },
      "session": {
        "fields": {
          "activeOrganizationId": {
            "type": "string",
            "required": false,
            "input": false
          }
        }
      }
    }
  },
  {
    "id": "convex",
    "schema": {
      "user": {
        "fields": {
          "userId": {
            "type": "string",
            "required": false,
            "input": false
          }
        }
      },
      "jwks": {
        "fields": {
          "publicKey": {
            "type": "string",
            "required": true
          },
          "privateKey": {
            "type": "string",
            "required": true
          },
          "createdAt": {
            "type": "date",
            "required": true
          },
          "expiresAt": {
            "type": "date",
            "required": false
          },
          "alg": {
            "type": "string",
            "required": false
          },
          "crv": {
            "type": "string",
            "required": false
          }
        }
      }
    }
  }
];
