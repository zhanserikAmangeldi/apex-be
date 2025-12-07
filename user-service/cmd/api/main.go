package main

import "net/http"

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Project is started!"))
	})

	http.ListenAndServe(":8080", mux)
}
